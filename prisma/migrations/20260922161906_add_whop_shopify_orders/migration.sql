-- CreateTable
CREATE TABLE "WhopShopifyOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "whopPaymentId" TEXT NOT NULL,
    "whopUserId" TEXT,
    "whopProductId" TEXT,
    "whopPlanId" TEXT,
    "shopifyDraftOrderId" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WhopShopifyOrder_whopPaymentId_key" ON "WhopShopifyOrder"("whopPaymentId");
