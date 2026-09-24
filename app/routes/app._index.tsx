import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="RenaAR">
      <s-section heading="Whop → Shopify → Mutual">
        <s-paragraph>
          This app connects Whop payments to Shopify orders and forwards
          fulfilment tracking back to Whop. There is no admin UI here yet —
          see the Test Order page to manually trigger the order flow.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
