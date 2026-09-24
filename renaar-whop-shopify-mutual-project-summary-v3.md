# RenaAR — Whop → Shopify → Mutual Dropshipping Integration

## 1. Project Goal

Build a reliable integration where:

1. A customer purchases one of two physical products through **Whop**.
2. Whop sends a verified `payment.succeeded` webhook to the RenaAR backend.
3. The backend maps the Whop product to the correct hard-coded Shopify product variant.
4. The backend creates a **Shopify Draft Order**.
5. The draft is immediately completed as a **PAID Shopify Order** because payment was already taken by Whop.
6. **Mutual Dropshipping** sees the Shopify order and fulfils it.
7. Mutual adds shipment/tracking information back into Shopify.
8. The RenaAR backend receives the Shopify fulfilment/tracking update.
9. Tracking and order status are passed back to **Whop**.

The connector sends **no customer emails**.

The target architecture is:

```text
Customer
   ↓
Whop Checkout
   ↓
payment.succeeded
   ↓
RenaAR Backend on Hetzner
   ↓
Verify Whop Webhook
   ↓
Check Idempotency
   ↓
Hard-coded Whop Product → Shopify Variant
   ↓
Create Shopify Draft Order
   ↓
Complete Draft as PAID
   ↓
Shopify Order
   ↓
Mutual Dropshipping
   ↓
Shipment + Tracking
   ↓
Shopify Fulfilment Webhook
   ↓
RenaAR Backend
   ↓
Tracking + Status → Whop
```

## 2. Current Status

Estimated overall project completion: **approximately 60–65%**.

### Completed

- Shopify custom-distribution app created.
- Shopify app installed and linked to the local project.
- Shopify access scopes configured.
- Shopify React Router project running locally.
- Embedded Shopify admin page tested.
- Shopify Admin GraphQL authentication confirmed.
- Shopify products/default variants successfully queried.
- Draft Order creation successfully tested.
- Draft Order completion successfully tested.
- Resulting Shopify orders are created as:
  - `PAID`
  - `UNFULFILLED`
- Reusable `createPaidShopifyOrder()` server helper created.
- Whop `payment.succeeded` webhook endpoint created.
- Whop webhook signature verification working.
- Whop webhook payload inspected and understood.
- Whop payment ID extracted.
- Whop user/member/membership IDs identified.
- Whop product/plan IDs identified.
- Customer name/email fields identified.
- Shipping-address handling added.
- Development-only synthetic test fallbacks added for:
  - shipping address
  - Whop test product
  - synthetic `.example` customer email
- Shopify offline admin access added for external Whop webhook requests.
- Prisma order-mapping model created.
- Whop ↔ Shopify order mapping stored.
- Idempotency tested successfully.
- Sending the same Whop payment webhook repeatedly does **not** create duplicate Shopify orders.

### Current proven development flow

```text
Whop synthetic payment.succeeded
        ↓
Webhook signature verified
        ↓
Development test fallbacks applied
        ↓
Shopify offline session loaded
        ↓
Draft Order created
        ↓
Draft completed
        ↓
Shopify Order #1006
        ↓
PAID / UNFULFILLED
        ↓
Order mapping stored in DB
        ↓
Repeated webhook returns duplicate=true
        ↓
No duplicate Shopify order
```

---

## 3. Current App Structure

Important files currently include:

```text
app/
├── lib/
│   ├── shopify-orders.server.ts
│   └── whop-orders.server.ts
│
├── routes/
│   ├── app.tsx
│   ├── app._index.tsx
│   ├── app.additional.tsx
│   ├── app.test-order.tsx
│   └── webhooks.whop.tsx
│
├── db.server.ts
├── routes.ts
└── shopify.server.ts

prisma/
├── schema.prisma
└── migrations/

shopify.app.toml
shopify.web.toml
package.json
```

---

## 4. Shopify App Permissions

Current scopes:

```text
write_draft_orders
read_draft_orders
read_orders
write_orders
read_products
```

These currently cover the Whop → Shopify order creation flow.

Additional fulfilment-related scopes may be added later only if required for the Shopify → tracking stage.

---

## 5. Product Mapping

Whop products must map to Shopify **Variant IDs**, not Shopify Product IDs.

Even when a Shopify product has no customer-selectable options, Shopify still creates one default variant.

Example structure:

```ts
const WHOP_PRODUCT_TO_SHOPIFY_VARIANT = {
  prod_WHOP_PRODUCT_1:
    "gid://shopify/ProductVariant/SHOPIFY_VARIANT_1",

  prod_WHOP_PRODUCT_2:
    "gid://shopify/ProductVariant/SHOPIFY_VARIANT_2",
};
```

### Important environment rule

During development:

```text
SHOPIFY_SHOP = development store
→ use development-store variant IDs
```

In production:

```text
SHOPIFY_SHOP = actual Shopify store
→ use actual-store variant IDs
```

Shopify IDs are store-specific and must not be mixed between stores.

---

## 6. Whop Webhook

Webhook route:

```text
POST /webhooks/whop
```

Subscribed event:

```text
payment.succeeded
```

The webhook currently:

1. Reads the raw request body.
2. Verifies the Whop signature.
3. Ignores events other than `payment.succeeded`.
4. Extracts the payment ID.
5. Checks whether that payment has already been processed.
6. Extracts product/customer/shipping details.
7. Maps the Whop product to a Shopify variant.
8. Loads an offline Shopify Admin client.
9. Creates the Whop order-processing DB record.
10. Creates and completes the Shopify Draft Order.
11. Stores the resulting Shopify IDs.
12. Returns a successful JSON response.

Important Whop fields identified:

```text
Payment ID:
data.id

Whop User ID:
data.user.id

Member ID:
data.member.id

Membership ID:
data.membership.id

Whop Product ID:
data.product.id

Whop Plan ID:
data.plan.id

Customer Email:
data.user.email

Customer Name:
data.user.name

Shipping Address:
data.shipping_address

Amount:
data.total

Currency:
data.currency
```

---

## 7. Idempotency

Idempotency is required because webhook providers can retry requests.

The system stores:

```text
whopPaymentId
```

as a unique value.

Before creating a Shopify order:

```text
Whop Payment
    ↓
Search database by whopPaymentId
    ↓
Already exists?
    ├── YES → return existing Shopify order
    └── NO  → continue creating order
```

This has been tested successfully.

Repeated synthetic webhook calls returned the same Shopify Order `#1006` instead of creating duplicate orders.

---

## 8. Database

### Final decision

The two Whop → Shopify product mappings will **not** be stored in the database.

There will always be exactly two products, so the mapping remains hard-coded in server configuration/code.

The database exists for **persistent integration state and safety**, not for product management.

### Why keep a database?

The most important reason is idempotency.

Whop may retry the same `payment.succeeded` webhook. Without persistent state, a restarted server could forget that a payment had already been processed and create another physical Shopify order.

The database permanently stores:

```text
Whop payment ID
↕
Shopify order ID
```

This prevents duplicate dropshipping orders.

The same mapping is also useful for the reverse fulfilment flow:

```text
Shopify order
→ Mutual adds tracking
→ RenaAR receives fulfilment update
→ lookup Whop payment
→ pass tracking/status back to Whop
```

### Final database location

PostgreSQL will run directly on the Hetzner VPS alongside the application.

```text
Hetzner VPS
├── RenaAR application
└── PostgreSQL
```

This removes the need for Railway Postgres, Neon, or Supabase.

The application can connect locally using a private connection string such as:

```text
postgresql://<user>:<password>@localhost:5432/renaar
```

The real credentials should be created on the server and stored only in environment variables.

### Minimum production tables

#### `Session`

Used by the Shopify app framework for installed-shop authentication/offline sessions.

#### `WhopShopifyOrder`

This is the only custom integration table required for V1.

Recommended simplified model:

```prisma
model WhopShopifyOrder {
  id                  Int      @id @default(autoincrement())
  whopPaymentId       String   @unique
  shopifyDraftOrderId String?
  shopifyOrderId      String?  @unique
  shopifyOrderName    String?
  status              String
  trackingNumber      String?
  trackingCompany     String?
  trackingUrl         String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

No product, product-mapping, customer, inventory, Whop-product, or Shopify-product table is required.

## 9. Why the App Needs Hosting

The important distinction is between the **Shopify admin UI** and the **integration backend**.

Shopify can host certain Shopify UI extensions, including App Home UI extensions.

However, this project requires a backend because external systems must contact it even when nobody has Shopify Admin open.

Whop needs to perform:

```text
POST https://YOUR-BACKEND/webhooks/whop
```

Later Shopify will also perform something like:

```text
POST https://YOUR-BACKEND/webhooks/shopify/fulfillment
```

The backend must therefore:

- have a permanent public HTTPS address;
- receive Whop webhooks 24/7;
- verify signatures;
- access the database;
- make Shopify Admin API calls;
- process Shopify fulfilment webhooks;
- potentially call Whop APIs;
- potentially send customer notifications;
- run independently of an open Shopify browser session.

This is why the current temporary Cloudflare development tunnel is not suitable for production.

---

## 10. Can the Whole App Be Hosted on Shopify?

Not with the current architecture.

Shopify can host the **App Home UI extension** portion of a custom-distribution app.

For a simple app with no server-side functionality, this can eliminate the need for a separate web server.

However, RenaAR requires:

```text
Whop webhooks
database access
server-side API logic
Shopify background webhook processing
tracking synchronization
idempotency
```

Those require an externally hosted backend.

A possible future hybrid architecture is:

```text
SHOPIFY HOSTS
└── App Home UI extension

EXTERNAL HOST
├── /webhooks/whop
├── /webhooks/shopify/fulfillment
├── Shopify API logic
├── Whop API logic
└── PostgreSQL access
```

This could reduce frontend hosting requirements, but it would **not remove the need for backend hosting**.

Because the current React Router app is already built and working, there is little benefit in rewriting the admin UI as a Shopify-hosted App Home extension right now.

---

## 11. Recommended Hosting

### Final hosting decision

The connector will be hosted on the dedicated Hetzner VPS already provisioned for this project.

Server details:

```text
Provider: Hetzner
Server: 2.29.56.23
Location: Helsinki
Plan: CX23
CPU: 2 vCPU
RAM: 4 GB
Disk: 40 GB
OS: Ubuntu 24.04
Open ports: 22, 80, 443
```

This is more than sufficient for the expected workload.

Railway, Vercel, Neon, and Railway Postgres are no longer required.

### Final production architecture

```text
GitHub
   ↓
Hetzner VPS
├── RenaAR Node/React Router app
├── PostgreSQL
├── Nginx
├── HTTPS
└── systemd or PM2
     ↓
Shopify
     ↓
Mutual Dropshipping
```

The backend must remain publicly reachable because Whop and Shopify need to send webhooks to it at any time.

### Security

The supplied private SSH key must remain private and must never be committed to GitHub or stored inside the application repository.

Initial provisioning can use root, but the production app should preferably run under a dedicated non-root deployment user.

### Domain recommendation

Use a dedicated hostname pointing to the VPS, for example:

```text
fulfillment.example.com
```

Then configure:

```text
https://fulfillment.example.com/webhooks/whop
https://fulfillment.example.com/webhooks/shopify/fulfillment
```

## 12. Environment Variables

Current development variables are conceptually:

```env
SHOPIFY_SHOP=extensibility-test1.myshopify.com

WHOP_API_KEY=...
WHOP_WEBHOOK_SECRET=...

DEV_ALLOW_FAKE_SHIPPING=true
DEV_ALLOW_FAKE_PRODUCT=true
DEV_ALLOW_FAKE_CUSTOMER=true
```

Secrets must never be committed to Git.

### Production

Production must use:

```env
SHOPIFY_SHOP=REAL-STORE.myshopify.com

WHOP_API_KEY=...
WHOP_WEBHOOK_SECRET=...

DATABASE_URL=postgresql://...

DEV_ALLOW_FAKE_SHIPPING=false
DEV_ALLOW_FAKE_PRODUCT=false
DEV_ALLOW_FAKE_CUSTOMER=false
```

The fake development fallbacks must never be enabled against the real store.

---

## 13. Development-Only Fallbacks

Whop's synthetic test webhook currently returns data that is deliberately unrealistic:

```text
shipping_address = null
product ID = synthetic prod_xxx value
email uses .example domain
```

Development fallbacks therefore exist so the full integration can be tested.

They currently provide:

- a fake UK shipping address;
- a known development Shopify variant;
- a valid test email address.

These are strictly testing tools.

In production, missing or invalid fulfilment data must cause the webhook to fail safely rather than creating a potentially incorrect physical shipment.

---

## 14. Production Order Flow

When moved to the real Shopify store, the intended flow is:

```text
1. Customer pays on Whop.

2. Whop sends:
   payment.succeeded

3. RenaAR verifies Whop signature.

4. RenaAR checks whopPaymentId.

5. Existing payment?
   YES → return success, do nothing.
   NO  → continue.

6. Extract:
   customer name
   email
   shipping address
   product ID
   payment ID
   user ID
   plan ID

7. Resolve:
   Whop Product ID → Real Shopify Variant ID

8. Create Shopify Draft Order.

9. Complete Draft Order as PAID.

10. Save:
    Whop Payment ID ↔ Shopify Order ID

11. Shopify Order is:
    PAID
    UNFULFILLED

12. Mutual sees the Shopify order.

13. Mutual fulfils the physical order.
```

---

## 15. Mutual Dropshipping Phase

This is the next major integration proof after production deployment.

The test should answer:

> Does Mutual automatically recognise and import a paid Shopify order created through the Admin API?

Things to verify:

```text
Correct Shopify product
Correct variant
Correct SKU if required
Correct quantity
Correct customer
Correct shipping address
Financial status = PAID
Fulfilment status = UNFULFILLED
Correct fulfilment location/service
```

Potential Mutual requirements to investigate if the order does not sync automatically:

- product needs to be linked/imported through Mutual;
- SKU needs to match;
- fulfilment location;
- fulfilment service association;
- specific Shopify product mapping inside Mutual.

No tracking work should be considered complete until the Mutual order-sync behaviour has been proven.

---

## 16. Tracking Phase

The supplied server requirements clarify the final reverse flow.

The connector **does not send customer emails**.

After Mutual fulfils an order, Mutual adds tracking information and fulfilment status into Shopify.

The intended flow is:

```text
Mutual
    ↓
Shopify fulfillment created/updated
    ↓
RenaAR Shopify webhook
    ↓
Identify Shopify Order
    ↓
Look up WhopShopifyOrder
    ↓
Retrieve Whop payment reference
    ↓
Read tracking + order status
    ↓
Pass tracking/status back to Whop
```

Likely tracking data:

```text
trackingNumber
trackingCompany
trackingUrl
fulfillmentStatus
```

The system should subscribe to the appropriate Shopify fulfilment webhook topic(s).

## 17. Refund / Cancellation Phase

Later production hardening should account for:

```text
Whop refund
        ↓
Shopify order cancellation/refund
        ↓
Prevent Mutual shipment where possible
```

This is especially important before order fulfilment.

Additional Whop refund-related webhook events should be investigated and added after the base production flow is stable.

---

## 18. Admin UI — Future Improvement

Because the Shopify app is embedded, the admin interface can eventually provide:

```text
Whop Payment
Shopify Order
Customer
Product
Status
Tracking
```

Useful actions could include:

```text
Retry failed Shopify creation
View Shopify order
View Whop payment
Copy tracking
Resend tracking notification
Manage product mappings
```

This is not required for V1.

The current priority is automation and reliability.

---

## 19. Remaining Project Phases

### Phase 1 — Shopify foundation

Status: **Complete**

- app
- scopes
- authentication
- product query
- draft creation
- paid completion

### Phase 2 — Whop webhook

Status: **Complete**

- webhook endpoint
- payment.succeeded
- signature verification
- payload parsing

### Phase 3 — Whop → Shopify automation

Status: **Complete in development**

- product mapping
- customer details
- shipping logic
- offline Shopify session
- automatic Shopify paid order

### Phase 4 — Idempotency

Status: **Complete in development**

- unique payment record
- duplicate detection
- order mapping
- status storage

### Phase 5 — Production infrastructure

Status: **Next**

- PostgreSQL
- hosting
- production environment variables
- permanent webhook URL

### Phase 6 — Real Shopify store

Status: **Pending**

- connect actual store
- real Shopify variant IDs
- disable all fake fallbacks
- real Whop checkout test

### Phase 7 — Mutual

Status: **Pending**

- confirm order sync
- confirm product recognition
- confirm agent fulfilment

### Phase 8 — Tracking

Status: **Pending**

- Shopify fulfilment webhook
- tracking extraction
- DB update
- customer notification

### Phase 9 — Production hardening

Status: **Pending**

- refunds
- cancellations
- retry behaviour
- error visibility
- optional admin dashboard
- monitoring/logging

---

## 20. Recommended Next Steps

The immediate production path is now:

```text
1. Commit the current working code.
2. Push the RenaAR repository to GitHub.
3. SSH into the dedicated Hetzner VPS.
4. Create a dedicated non-root deployment user.
5. Install Git, Node.js, PostgreSQL, Nginx, and systemd service or PM2.
6. Clone the GitHub repository onto the VPS.
7. Change Prisma from local SQLite to PostgreSQL.
8. Create the production PostgreSQL database and user.
9. Run Prisma migrations.
10. Add production environment variables.
11. Run the RenaAR application as a persistent service.
12. Configure Nginx reverse proxy.
13. Point a domain/subdomain to the VPS.
14. Configure HTTPS.
15. Configure the actual Shopify store.
16. Replace development-store Shopify Variant IDs with the two real-store Variant IDs.
17. Disable all DEV_ALLOW_FAKE_* flags.
18. Update the Whop webhook destination to the permanent HTTPS URL.
19. Perform one controlled real Whop purchase.
20. Verify Whop → Shopify PAID / UNFULFILLED order.
21. Verify Shopify → Mutual order sync.
22. Build Shopify fulfilment/tracking webhook.
23. Pass tracking/status back to Whop.
24. Test the full flow end-to-end.
```

There is no need for Railway, Vercel, Neon, Supabase, a product-mapping database, or a product-management UI.

## 21. Recommended Production Architecture

```text
                    ┌─────────────────┐
                    │      WHOP       │
                    │ Checkout/Payment│
                    └────────┬────────┘
                             │
                    payment.succeeded
                             │
                             ▼
                 ┌──────────────────────┐
                 │    RenaAR Backend    │
                 │     Hetzner VPS      │
                 │                      │
                 │ /webhooks/whop       │
                 │ /webhooks/shopify    │
                 │ Shopify API logic    │
                 │ Whop API logic       │
                 └──────────┬───────────┘
                            │
                     ┌──────┴───────┐
                     │              │
                     ▼              ▼
              ┌────────────┐  ┌───────────────┐
              │ PostgreSQL │  │    Shopify    │
              │ local VPS  │  │  Real Store   │
              └────────────┘  └───────┬───────┘
                                      │
                                      ▼
                              ┌───────────────┐
                              │    Mutual     │
                              │ Dropshipping  │
                              └───────┬───────┘
                                      │
                                   Tracking
                                      │
                                      ▼
                                  Shopify
                                      │
                              fulfilment webhook
                                      │
                                      ▼
                               RenaAR Backend
                                      │
                                      ▼
                         Tracking + Status → Whop
```

The connector does not send customer emails.

## 22. Definition of Done

The project is complete when this can happen without manual intervention:

```text
Customer purchases on Whop
        ↓
Payment succeeds
        ↓
Exactly one Shopify order is created
        ↓
Order is marked PAID
        ↓
Correct physical product + shipping address
        ↓
Mutual receives order
        ↓
Mutual fulfils order
        ↓
Tracking arrives in Shopify
        ↓
RenaAR detects tracking/status
        ↓
Tracking/status is passed back to Whop
```

Plus:

```text
Duplicate Whop webhooks
→ do NOT create duplicate orders

Invalid Whop webhook
→ rejected

Missing live shipping address
→ no order created

Unknown live product
→ no order created

Shopify/API failure
→ recorded and visible

Refund/cancellation
→ handled safely

Connector customer emails
→ none
```

That is the target production-ready RenaAR integration.
