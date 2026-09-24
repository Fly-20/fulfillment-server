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
  email: string;
  firstName: string;
  lastName: string;
  shippingAddress: ShippingAddress;
  quantity?: number;
  whopPaymentId?: string;
};

export async function createPaidShopifyOrder({
  admin,
  variantId,
  email,
  shippingAddress,
  quantity = 1,
  whopPaymentId,
}: CreatePaidShopifyOrderParams) {
  // 1. Create Shopify Draft Order
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
        input: {
          email,

          lineItems: [
            {
              variantId,
              quantity,
            },
          ],

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
        },
      },
    },
  );

  const createJson = await createResponse.json();

  const createResult = createJson.data?.draftOrderCreate;

  if (!createResult) {
    throw new Error("Shopify did not return draftOrderCreate");
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
    throw new Error("Shopify draft order was not created");
  }

  // 2. Complete Draft Order as paid
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

  const completeJson = await completeResponse.json();

  const completeResult = completeJson.data?.draftOrderComplete;

  if (!completeResult) {
    throw new Error("Shopify did not return draftOrderComplete");
  }

  if (completeResult.userErrors?.length) {
    throw new Error(
      `Draft order completion failed: ${JSON.stringify(
        completeResult.userErrors,
      )}`,
    );
  }

  const completedDraftOrder = completeResult.draftOrder;
  const order = completedDraftOrder?.order;

  if (!order?.id) {
    throw new Error("Shopify order was not created");
  }

  return {
    draftOrder: {
      id: draftOrder.id,
      name: draftOrder.name,
      total: draftOrder.totalPriceSet?.shopMoney?.amount,
      currency: draftOrder.totalPriceSet?.shopMoney?.currencyCode,
    },

    order: {
      id: order.id,
      name: order.name,
      financialStatus: order.displayFinancialStatus,
      fulfillmentStatus: order.displayFulfillmentStatus,
    },
  };
}