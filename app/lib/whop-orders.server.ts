import db from "../db.server";

export async function findWhopOrderByPaymentId(
  whopPaymentId: string,
) {
  return db.whopShopifyOrder.findUnique({
    where: {
      whopPaymentId,
    },
  });
}

export async function createWhopOrderRecord({
  whopPaymentId,
  whopUserId,
  whopProductId,
  whopPlanId,
}: {
  whopPaymentId: string;
  whopUserId?: string;
  whopProductId?: string;
  whopPlanId?: string;
}) {
  return db.whopShopifyOrder.create({
    data: {
      whopPaymentId,
      whopUserId,
      whopProductId,
      whopPlanId,
      status: "PROCESSING",
    },
  });
}

export async function markWhopOrderCompleted({
  whopPaymentId,
  shopifyDraftOrderId,
  shopifyOrderId,
  shopifyOrderName,
}: {
  whopPaymentId: string;
  shopifyDraftOrderId: string;
  shopifyOrderId: string;
  shopifyOrderName?: string;
}) {
  return db.whopShopifyOrder.update({
    where: {
      whopPaymentId,
    },

    data: {
      shopifyDraftOrderId,
      shopifyOrderId,
      shopifyOrderName,
      status: "COMPLETED",
    },
  });
}

export async function markWhopOrderFailed(
  whopPaymentId: string,
) {
  return db.whopShopifyOrder.update({
    where: {
      whopPaymentId,
    },

    data: {
      status: "FAILED",
    },
  });
}