import type { ActionFunctionArgs } from "react-router";
import { unwrapWebhook } from "@whop/sdk/helpers";

import { unauthenticated } from "../shopify.server";
import { createPaidShopifyOrder } from "../lib/shopify-orders.server";

import {
  createWhopOrderRecord,
  findWhopOrderByPaymentId,
  markWhopOrderCompleted,
  markWhopOrderFailed,
} from "../lib/whop-orders.server";

/**
 * Whop Product ID → Shopify Variant ID
 *
 * IMPORTANT:
 * These must be Shopify VARIANT IDs from the store configured
 * in SHOPIFY_SHOP.
 *
 * Even a Shopify product with no selectable options has a
 * default ProductVariant internally.
 */
const WHOP_PRODUCT_TO_SHOPIFY_VARIANT: Record<string, string> = {
  prod_FeczPt3Ztejl3:
    "gid://shopify/ProductVariant/49485501825320",

  prod_luTDrVUgegPyK:
    "gid://shopify/ProductVariant/47243127882024",
};

type WhopAddress = {
  name?: string | null;

  first_name?: string | null;
  last_name?: string | null;

  line_1?: string | null;
  line_2?: string | null;

  address_line_1?: string | null;
  address_line_2?: string | null;

  city?: string | null;
  state?: string | null;

  postal_code?: string | null;
  zip?: string | null;

  country?: string | null;
  country_code?: string | null;

  phone?: string | null;
};

type WhopPaymentSucceededData = {
  id: string;

  currency?: string | null;
  total?: number | null;

  product?: {
    id?: string | null;
    title?: string | null;
  } | null;

  plan?: {
    id?: string | null;
  } | null;

  user?: {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    username?: string | null;
  } | null;

  member?: {
    id?: string | null;
  } | null;

  membership?: {
    id?: string | null;
  } | null;

  shipping_address?: WhopAddress | null;
};

type WhopWebhookEvent = {
  id: string;
  type: string;
  data: WhopPaymentSucceededData;
};

function splitName(fullName?: string | null) {
  const value = fullName?.trim() || "";

  if (!value) {
    return {
      firstName: "Customer",
      lastName: "",
    };
  }

  const parts = value.split(/\s+/);

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  /**
   * -------------------------------------------------------
   * 1. Configuration
   * -------------------------------------------------------
   */

  const webhookSecret = process.env.WHOP_WEBHOOK_SECRET;
  const shopifyShop = process.env.SHOPIFY_SHOP;

  if (!webhookSecret) {
    console.error("WHOP_WEBHOOK_SECRET is missing");

    return new Response("Webhook secret not configured", {
      status: 503,
    });
  }

  if (!shopifyShop) {
    console.error("SHOPIFY_SHOP is missing");

    return new Response("Shopify shop not configured", {
      status: 503,
    });
  }

  /**
   * -------------------------------------------------------
   * 2. Read + verify Whop webhook
   * -------------------------------------------------------
   */

  const rawBody = await request.text();

  let event: WhopWebhookEvent;

  try {
    event = unwrapWebhook(rawBody, {
      headers: Object.fromEntries(request.headers),
      key: webhookSecret,
    }) as WhopWebhookEvent;
  } catch (error) {
    console.error("Whop webhook verification failed:", error);

    return new Response("Invalid webhook signature", {
      status: 401,
    });
  }

  console.log("Whop webhook verified:", {
    eventId: event.id,
    eventType: event.type,
  });

  /**
   * -------------------------------------------------------
   * 3. Only process successful payments
   * -------------------------------------------------------
   */

  if (event.type !== "payment.succeeded") {
    return new Response("Ignored", {
      status: 200,
    });
  }

  const payment = event.data;

  const paymentId = payment.id;
  const productId = payment.product?.id;

  let email = payment.user?.email;
  let shippingAddress = payment.shipping_address;

  /**
   * -------------------------------------------------------
   * 4. Validate payment ID first
   * -------------------------------------------------------
   */

  if (!paymentId) {
    return new Response("Missing Whop payment ID", {
      status: 400,
    });
  }

  /**
   * -------------------------------------------------------
   * 5. Idempotency check
   * -------------------------------------------------------
   *
   * If Whop sends the same payment webhook again, we return
   * successfully without creating another Shopify order.
   */

  const existingOrder =
    await findWhopOrderByPaymentId(paymentId);

  if (existingOrder) {
    console.log("Whop payment already processed:", {
      paymentId,
      status: existingOrder.status,
      shopifyOrderId: existingOrder.shopifyOrderId,
      shopifyOrderName: existingOrder.shopifyOrderName,
    });

    return Response.json({
      success: true,
      duplicate: true,
      message: "Payment already processed",

      whopPaymentId: paymentId,

      status: existingOrder.status,

      shopifyOrderId:
        existingOrder.shopifyOrderId,

      shopifyOrderName:
        existingOrder.shopifyOrderName,
    });
  }

  /**
   * -------------------------------------------------------
   * 6. Validate product
   * -------------------------------------------------------
   */

  if (!productId) {
    return new Response("Missing Whop product ID", {
      status: 400,
    });
  }

  /**
   * -------------------------------------------------------
   * 7. Customer email
   * -------------------------------------------------------
   */

  if (!email) {
    const allowFakeCustomer =
      process.env.DEV_ALLOW_FAKE_CUSTOMER === "true";

    if (!allowFakeCustomer) {
      return new Response("Missing customer email", {
        status: 400,
      });
    }

    console.warn(
      "DEV MODE: Whop test event has no customer email. Using test email.",
      {
        paymentId,
      },
    );

    email = "test.customer@gmail.com";
  }

  /**
   * Whop's synthetic event currently uses domains such as:
   *
   * marcus@shinetime.example
   *
   * Shopify rejects .example domains, so swap it only in
   * development.
   */

  if (email.endsWith(".example")) {
    const allowFakeCustomer =
      process.env.DEV_ALLOW_FAKE_CUSTOMER === "true";

    if (!allowFakeCustomer) {
      return new Response(
        "Invalid synthetic customer email",
        {
          status: 400,
        },
      );
    }

    console.warn(
      "DEV MODE: Whop synthetic email detected. Using test email.",
      {
        originalEmail: email,
        paymentId,
      },
    );

    email = "test.customer@gmail.com";
  }

  /**
   * -------------------------------------------------------
   * 8. Shipping address
   * -------------------------------------------------------
   *
   * Whop's generated test payment currently gives us:
   *
   * shipping_address: null
   *
   * For development only, inject a fake address.
   */

  if (!shippingAddress) {
    const allowFakeShipping =
      process.env.DEV_ALLOW_FAKE_SHIPPING === "true";

    if (!allowFakeShipping) {
      console.error(
        "Whop payment has no shipping address:",
        {
          paymentId,
        },
      );

      return new Response("Missing shipping address", {
        status: 400,
      });
    }

    console.warn(
      "DEV MODE: Whop payment has no shipping address. Using test address.",
      {
        paymentId,
      },
    );

    shippingAddress = {
      first_name: "Test",
      last_name: "Customer",
      line_1: "10 Downing Street",
      line_2: null,
      city: "London",
      state: "London",
      postal_code: "SW1A 2AA",
      country_code: "GB",
    };
  }

  /**
   * -------------------------------------------------------
   * 9. Map Whop product → Shopify variant
   * -------------------------------------------------------
   */

  let variantId =
    WHOP_PRODUCT_TO_SHOPIFY_VARIANT[productId];

  /**
   * Whop's generated test webhook uses a synthetic:
   *
   * prod_xxxxxxxxxxxxxx
   *
   * so during development we allow a fallback Shopify
   * variant.
   */

  if (!variantId) {
    const allowFakeProduct =
      process.env.DEV_ALLOW_FAKE_PRODUCT === "true";

    if (!allowFakeProduct) {
      console.error(
        "No Shopify variant mapping for Whop product:",
        {
          productId,
          paymentId,
        },
      );

      return new Response("Product mapping not found", {
        status: 400,
      });
    }

    console.warn(
      "DEV MODE: Whop test product has no mapping. Using fallback Shopify variant.",
      {
        productId,
        paymentId,
      },
    );

    /**
     * DEV STORE ONLY
     *
     * Change this if required to a known variant from
     * extensibility-test1.
     */
    variantId =
      "gid://shopify/ProductVariant/48038664601916";
  }

  /**
   * -------------------------------------------------------
   * 10. Prepare customer/address details
   * -------------------------------------------------------
   */

  const { firstName, lastName } =
    splitName(payment.user?.name);

  const countryCode =
    shippingAddress.country_code ??
    shippingAddress.country;

  const address1 =
    shippingAddress.line_1 ??
    shippingAddress.address_line_1;

  const address2 =
    shippingAddress.line_2 ??
    shippingAddress.address_line_2 ??
    undefined;

  const zip =
    shippingAddress.postal_code ??
    shippingAddress.zip;

  if (
    !address1 ||
    !shippingAddress.city ||
    !zip ||
    !countryCode
  ) {
    console.error("Incomplete shipping address:", {
      paymentId,
      shippingAddress,
    });

    return new Response("Incomplete shipping address", {
      status: 400,
    });
  }

  /**
   * Tracks whether this webhook created the DB record.
   *
   * We don't want to mark some pre-existing record FAILED
   * accidentally.
   */
  let orderRecordCreated = false;

  /**
   * -------------------------------------------------------
   * 11. Create Shopify order
   * -------------------------------------------------------
   */

  try {
    /**
     * Use Shopify's OFFLINE session.
     *
     * This request originates from Whop, not from the
     * embedded Shopify Admin UI.
     */
    const { admin } =
      await unauthenticated.admin(shopifyShop);

    /**
     * Create idempotency/order mapping record BEFORE
     * creating the Shopify order.
     */
    await createWhopOrderRecord({
      whopPaymentId: paymentId,

      whopUserId:
        payment.user?.id ?? undefined,

      whopProductId:
        productId,

      whopPlanId:
        payment.plan?.id ?? undefined,
    });

    orderRecordCreated = true;

    /**
     * Create Shopify Draft Order and immediately complete
     * it as PAID.
     */
    const result = await createPaidShopifyOrder({
      admin,

      variantId,

      email,

      firstName,
      lastName,

      shippingAddress: {
        firstName:
          shippingAddress.first_name ??
          firstName,

        lastName:
          shippingAddress.last_name ??
          lastName,

        address1,

        address2,

        city:
          shippingAddress.city,

        province:
          shippingAddress.state ??
          undefined,

        zip,

        countryCode,

        phone:
          shippingAddress.phone ??
          undefined,
      },

      quantity: 1,

      whopPaymentId:
        paymentId,
    });

    /**
     * -------------------------------------------------------
     * 12. Store Shopify IDs against Whop payment
     * -------------------------------------------------------
     */

    await markWhopOrderCompleted({
      whopPaymentId:
        paymentId,

      shopifyDraftOrderId:
        result.draftOrder.id,

      shopifyOrderId:
        result.order.id,

      shopifyOrderName:
        result.order.name,
    });

    /**
     * -------------------------------------------------------
     * 13. Success logging
     * -------------------------------------------------------
     */

    console.log(
      "Shopify order created from Whop:",
      {
        whopPaymentId:
          paymentId,

        whopUserId:
          payment.user?.id,

        whopMemberId:
          payment.member?.id,

        whopMembershipId:
          payment.membership?.id,

        whopProductId:
          productId,

        whopPlanId:
          payment.plan?.id,

        shopifyDraftOrderId:
          result.draftOrder.id,

        shopifyOrderId:
          result.order.id,

        shopifyOrderName:
          result.order.name,

        financialStatus:
          result.order.financialStatus,

        fulfillmentStatus:
          result.order.fulfillmentStatus,
      },
    );

    /**
     * -------------------------------------------------------
     * 14. Success response to Whop
     * -------------------------------------------------------
     */

    return Response.json({
      success: true,

      duplicate: false,

      whop: {
        paymentId,

        userId:
          payment.user?.id,

        memberId:
          payment.member?.id,

        membershipId:
          payment.membership?.id,

        productId,

        planId:
          payment.plan?.id,

        currency:
          payment.currency,

        total:
          payment.total,
      },

      shopify: {
        draftOrder:
          result.draftOrder,

        order:
          result.order,
      },
    });
  } catch (error) {
    /**
     * -------------------------------------------------------
     * 15. Record processing failure
     * -------------------------------------------------------
     */

    if (orderRecordCreated) {
      try {
        await markWhopOrderFailed(paymentId);
      } catch (databaseError) {
        console.error(
          "Failed to mark Whop order record as FAILED:",
          databaseError,
        );
      }
    }

    console.error(
      "Failed to create Shopify order from Whop payment:",
      error,
    );

    return new Response(
      error instanceof Error
        ? error.message
        : "Failed to create Shopify order",
      {
        status: 500,
      },
    );
  }
};