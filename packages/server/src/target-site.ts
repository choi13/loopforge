import http from "node:http";

/**
 * LoopMart — the seeded QA target for the browser environment. A tiny,
 * fully deterministic demo shop served from inline HTML strings on its own
 * port (8788 by default), separate from the LoopForge API. The checkout flow
 * carries ONE planted bug: POST /order always responds 500. The browser
 * environment's whole reason to exist is finding it.
 */

interface Product {
  id: string;
  name: string;
  price: string;
}

const PRODUCTS: Product[] = [
  { id: "p1", name: "Loop Mug", price: "$14" },
  { id: "p2", name: "Forge Hoodie", price: "$49" },
  { id: "p3", name: "Agent Sticker Pack", price: "$6" },
];

const STYLE =
  "body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#222}" +
  "nav a{margin-right:1rem}header{border-bottom:1px solid #ddd;margin-bottom:1rem}" +
  "article{border:1px solid #ddd;border-radius:6px;padding:0.75rem 1rem;margin:0.75rem 0}" +
  "button{padding:0.4rem 1rem}input{padding:0.4rem;margin-right:0.5rem}";

/** Shared page shell: doctype, title, minimal inline CSS, nav header. */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title><style>${STYLE}</style></head>
<body>
<header>
  <h1>LoopMart</h1>
  <nav><a href="/">Home</a><a href="/products">Products</a><a href="/checkout">Checkout</a></nav>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

const HOME_PAGE = layout(
  "LoopMart",
  `<h2>Welcome to LoopMart</h2>
<p>The tiny demo shop used as the LoopForge web-QA target.</p>
<p>Browse the <a href="/products">Products</a> or go straight to <a href="/checkout">Checkout</a>.</p>`,
);

const PRODUCTS_PAGE = layout(
  "LoopMart — Products",
  `<h2>Products</h2>
${PRODUCTS.map(
  (p) => `<article>
  <h3>${p.name}</h3>
  <p>${p.price}</p>
  <a href="/checkout?item=${p.id}">Add to cart</a>
</article>`,
).join("\n")}`,
);

function checkoutPage(itemId: string | null): string {
  const item = PRODUCTS.find((p) => p.id === itemId);
  const cartLine = item
    ? `<p>In your cart: ${item.name} (${item.price})</p>`
    : `<p>Your cart is empty — you can still place a test order.</p>`;
  return layout(
    "LoopMart — Checkout",
    `<h2>Checkout</h2>
${cartLine}
<form method="POST" action="/order">
  <label>Name <input type="text" name="name" placeholder="Your name"></label>
  <button type="submit">Place order</button>
</form>`,
  );
}

/** THE PLANTED BUG: placing an order always fails with a 500. */
const ORDER_ERROR_PAGE = layout(
  "LoopMart — Error",
  `<h2>Internal Server Error (500)</h2>
<p>Order processing failed: ERR_ORDER_FAILED</p>
<p><a href="/checkout">Back to checkout</a></p>`,
);

const NOT_FOUND_PAGE = layout(
  "LoopMart — Not Found",
  `<h2>Page not found</h2><p><a href="/">Back to the home page</a></p>`,
);

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * Create the LoopMart server and start listening on the given port. Returns
 * the http.Server so callers (and tests, which pass port 0) can await its
 * "listening" event, read the bound address, and close it.
 */
export function startTargetSite(port = 8788): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/") {
      sendHtml(res, 200, HOME_PAGE);
      return;
    }
    if (req.method === "GET" && pathname === "/products") {
      sendHtml(res, 200, PRODUCTS_PAGE);
      return;
    }
    if (req.method === "GET" && pathname === "/checkout") {
      sendHtml(res, 200, checkoutPage(url.searchParams.get("item")));
      return;
    }
    if (req.method === "POST" && pathname === "/order") {
      // Drain the form body we never read, then fail — this is the bug.
      req.resume();
      sendHtml(res, 500, ORDER_ERROR_PAGE);
      return;
    }
    sendHtml(res, 404, NOT_FOUND_PAGE);
  });

  server.listen(port);
  return server;
}
