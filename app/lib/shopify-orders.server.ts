type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

type ShippingAddress = {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  province?: string;
  zip: string;
  countryCode: string;
  phone?: string;
};

type CreatePaidShopifyOrderParams = {
  admin: ShopifyAdminClient;
  variantId: string;
  email?: string;
  shippingAddress: ShippingAddress;
  quantity?: number;
  whopPaymentId?: string;
  whopTotal?: number | null;
  whopCurrency?: string | null;
};

export async function createPaidShopifyOrder({
  admin,
  variantId,
  email,
  shippingAddress,
  quantity = 1,
  whopPaymentId,
  whopTotal,
  whopCurrency,
}: CreatePaidShopifyOrderParams) {
  // Get Shopify variant price + store currency
  const variantResponse = await admin.graphql(
    `#graphql
    query GetVariantPrice($id: ID!) {
      productVariant(id: $id) {
        id
        price
      }
      shop {
        currencyCode
      }
    }`,
    {
      variables: {
        id: variantId,
      },
    },
  );

  const variantJson = await variantResponse.json();

  if (variantJson.errors?.length) {
    throw new Error(
      `Failed to fetch Shopify variant price: ${JSON.stringify(
        variantJson.errors,
      )}`,
    );
  }

  const variant = variantJson.data?.productVariant;
  const shopCurrency = variantJson.data?.shop?.currencyCode;
  
  if (!variant?.id) {
    throw new Error(`Shopify variant not found: ${variantId}`);
  }
      if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
    throw new Error(
      `Invalid Shopify order quantity: ${quantity}`,
    );
  }
  if (whopTotal == null) {
    throw new Error("Whop payment total is missing");
  }

  if (
    whopCurrency &&
    shopCurrency &&
    whopCurrency.toUpperCase() !== shopCurrency.toUpperCase()
  ) {
    throw new Error(
      `Currency mismatch: Whop ${whopCurrency} vs Shopify ${shopCurrency}`,
    );
  }

  const shopifyUnitPrice = Number(variant.price);

  const whopPaid = Number(whopTotal);

  if (!Number.isFinite(shopifyUnitPrice)) {
    throw new Error("Invalid Shopify variant price");
  }

  if (!Number.isFinite(whopPaid)) {
    throw new Error("Invalid Whop payment total");
  }

  const shopifyUnitPriceCents = Math.round(
    shopifyUnitPrice * 100,
  );

  const whopPaidCents = Math.round(whopPaid * 100);

  if (whopPaidCents < 0) {
    throw new Error(
      "Whop payment total cannot be negative",
    );
  }

  const shopifyBaseTotalCents =
    shopifyUnitPriceCents * quantity;

  if (whopPaidCents > shopifyBaseTotalCents) {
    throw new Error(
      `Whop payment ${whopPaid} is greater than Shopify price ${
        shopifyBaseTotalCents / 100
      }`,
    );
  }

  const discountAmount =
    Math.max(
      0,
      shopifyBaseTotalCents - whopPaidCents,
    ) / 100;

  const lineItem: Record<string, unknown> = {
    variantId,
    quantity,
  };

  if (discountAmount > 0) {
    lineItem.appliedDiscount = {
      title: "Whop discount",
      description: whopPaymentId
        ? `Whop payment ${whopPaymentId}`
        : "Whop discount",
      valueType: "FIXED_AMOUNT",
      value: discountAmount,
    };
  }

  const draftOrderInput: Record<string, unknown> = {
    lineItems: [lineItem],

    shippingAddress: {
      firstName: shippingAddress.firstName,
      lastName: shippingAddress.lastName,
      address1: shippingAddress.address1,
      address2: shippingAddress.address2,
      city: shippingAddress.city,
      province: shippingAddress.province,
      zip: shippingAddress.zip,
      countryCode: shippingAddress.countryCode,
      phone: shippingAddress.phone,
    },

    tags: ["Whop"],

    note: whopPaymentId
      ? `Paid via Whop. Payment ID: ${whopPaymentId}`
      : "Paid via Whop",
  };

  if (email) {
    draftOrderInput.email = email;
  }

  // Create Draft Order
  const createResponse = await admin.graphql(
    `#graphql
    mutation CreateDraftOrder($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
          name
          status
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: draftOrderInput,
      },
    },
  );

  const createJson = await createResponse.json();

  const createResult =
    createJson.data?.draftOrderCreate;

  if (!createResult) {
    throw new Error(
      "Shopify did not return draftOrderCreate",
    );
  }

  if (createResult.userErrors?.length) {
    throw new Error(
      `Draft order creation failed: ${JSON.stringify(
        createResult.userErrors,
      )}`,
    );
  }

  const draftOrder = createResult.draftOrder;

  if (!draftOrder?.id) {
    throw new Error(
      "Shopify draft order was not created",
    );
  }

  // Complete Draft Order as paid
  const completeResponse = await admin.graphql(
    `#graphql
    mutation CompleteDraftOrder($id: ID!) {
      draftOrderComplete(id: $id) {
        draftOrder {
          id
          status
          order {
            id
            name
            displayFinancialStatus
            displayFulfillmentStatus
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: draftOrder.id,
      },
    },
  );

  const completeJson =
    await completeResponse.json();

  const completeResult =
    completeJson.data?.draftOrderComplete;

  if (!completeResult) {
    throw new Error(
      "Shopify did not return draftOrderComplete",
    );
  }

  if (completeResult.userErrors?.length) {
    throw new Error(
      `Draft order completion failed: ${JSON.stringify(
        completeResult.userErrors,
      )}`,
    );
  }

  const order =
    completeResult.draftOrder?.order;

  if (!order?.id) {
    throw new Error(
      "Shopify order was not created",
    );
  }

  return {
    draftOrder: {
      id: draftOrder.id,
      name: draftOrder.name,
      total:
        draftOrder.totalPriceSet?.shopMoney
          ?.amount,
      currency:
        draftOrder.totalPriceSet?.shopMoney
          ?.currencyCode,
    },

    order: {
      id: order.id,
      name: order.name,
      financialStatus:
        order.displayFinancialStatus,
      fulfillmentStatus:
        order.displayFulfillmentStatus,
    },
  };
}