import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type http from "node:http";
import { startTargetSite } from "./target-site";

/**
 * The LoopMart demo shop, exercised over real HTTP on an ephemeral port —
 * no Playwright involved. These pin the exact page contents the browser
 * environment's tools and the web-qa suite depend on.
 */

let server: http.Server;
let base: string;

before(async () => {
  server = startTargetSite(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

test("GET / serves the home page with nav links to products and checkout", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /LoopMart/);
  assert.match(html, /href="\/products"/);
  assert.match(html, /href="\/checkout"/);
});

test("GET /products lists 3 products, each with an Add to cart link", async () => {
  const res = await fetch(`${base}/products`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const addToCart = html.match(/Add to cart/g) ?? [];
  assert.equal(addToCart.length, 3);
  for (const id of ["p1", "p2", "p3"]) {
    assert.match(html, new RegExp(`href="/checkout\\?item=${id}"`));
  }
});

test("GET /checkout serves the order form posting to /order", async () => {
  const res = await fetch(`${base}/checkout?item=p1`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /placeholder="Your name"/);
  assert.match(html, /Place order/);
  assert.match(html, /method="POST" action="\/order"/);
  // The selected item is reflected on the page.
  assert.match(html, /Loop Mug/);
});

test("POST /order is the planted bug: always 500 with the exact error markers", async () => {
  const res = await fetch(`${base}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "name=QA+Bot",
  });
  assert.equal(res.status, 500);
  const html = await res.text();
  assert.ok(html.includes("Internal Server Error (500)"));
  assert.ok(html.includes("ERR_ORDER_FAILED"));
});

test("unknown paths return 404", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});
