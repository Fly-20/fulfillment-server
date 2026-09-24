import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";

import { authenticate } from "../shopify.server";
import { createPaidShopifyOrder } from "../lib/shopify-orders.server";

const TEST_VARIANT_ID =
  "gid://shopify/ProductVariant/53233261052185";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return {
    variantId: TEST_VARIANT_ID,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const result = await createPaidShopifyOrder({
      admin,
      variantId: TEST_VARIANT_ID,

      email: "test@example.com",

      firstName: "Test",
      lastName: "Customer",

      shippingAddress: {
        firstName: "Test",
        lastName: "Customer",
        address1: "10 Downing Street",
        city: "London",
        zip: "SW1A 2AA",
        countryCode: "GB",
      },

      quantity: 1,

      whopPaymentId: "test_whop_payment_123",
    });

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    console.error("Failed to create Shopify test order:", error);

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error occurred while creating the Shopify order",
    };
  }
};

export default function TestOrderPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  return (
    <div
      style={{
        maxWidth: "800px",
        margin: "40px auto",
        padding: "24px",
      }}
    >
      <h1>Whop → Shopify Test Order</h1>

      <p>
        This creates a Shopify draft order using the development-store
        test product and immediately completes it as paid.
      </p>

      <p>
        <strong>Test variant:</strong> {TEST_VARIANT_ID}
      </p>

      <Form method="post">
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            padding: "12px 18px",
            cursor: isSubmitting ? "not-allowed" : "pointer",
          }}
        >
          {isSubmitting
            ? "Creating order..."
            : "Create Test Shopify Order"}
        </button>
      </Form>

      {actionData && (
        <div style={{ marginTop: "30px" }}>
          <h2>Result</h2>

          <pre
            style={{
              padding: "16px",
              overflowX: "auto",
              background: "#f4f4f4",
            }}
          >
            {JSON.stringify(actionData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}