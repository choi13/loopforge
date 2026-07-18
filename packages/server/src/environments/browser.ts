import type { MockStep, Tool, ToolResult } from "@loopforge/core";
import type { PublishState, RunEnvironment } from "./index";

/**
 * The browser environment: an autonomous web-QA agent driving a real headless
 * Chromium (Playwright) against the seeded LoopMart demo shop the server
 * itself hosts on http://localhost:8788 (see ../target-site.ts). Four tools —
 * goto / read_page / click / fill — plus an env_state snapshot (URL, title,
 * step count, JPEG screenshot as a data URL) after every successful goto or
 * click so the dashboard can show what the agent sees.
 *
 * Playwright is imported LAZILY inside the launcher (with a non-literal
 * specifier so typechecking never resolves the module): the server boots and
 * every other environment works even when the dependency or its Chromium
 * binary is missing. In that case browser tools return isError results whose
 * message includes the fix ("npx playwright install chromium") and the run
 * finishes normally instead of crashing the server.
 */

/** The only origin the QA sandbox may visit. */
export const TARGET_ORIGIN = "http://localhost:8788";

const ORIGIN_BLOCKED_MESSAGE = `This QA sandbox can only visit ${TARGET_ORIGIN}`;

export const BROWSER_DEMO_TASK =
  "Test the checkout flow of the demo shop at http://localhost:8788. Verify a user can place an order, and report any bug you find.";

const SYSTEM_PROMPT =
  "You are an autonomous web-QA agent testing a small demo web shop. Explore the site and verify the checkout flow end to end: browse the products, add one to the cart, fill in the order form, and place the order. Tools: goto navigates to a URL, read_page summarizes the current page, click presses the first link or button matching its visible text, and fill types into the form field matching a placeholder or label. Only the demo shop at http://localhost:8788 is reachable — every other origin is blocked. If anything is broken, report the bug precisely with step-by-step reproduction instructions. When your verification is complete (whether the flow works or not), reply with a short QA report and stop calling tools.";

/** Viewport + screenshot settings — small JPEGs keep env_state payloads light. */
const VIEWPORT = { width: 800, height: 600 };
const SCREENSHOT_QUALITY = 45;
/** How long click waits for a triggered navigation before assuming none. */
const NAV_TIMEOUT_MS = 5_000;
/** Max characters of body text included in a page summary. */
const PAGE_TEXT_MAX_CHARS = 2_000;

/**
 * Minimal structural types for the slice of Playwright we use. Deliberately
 * NOT imported from the package: typechecking must succeed before the
 * dependency is installed, so the real module is only touched at runtime.
 */
interface PWLocator {
  count(): Promise<number>;
  nth(index: number): PWLocator;
  innerText(options?: { timeout?: number }): Promise<string>;
  getAttribute(name: string, options?: { timeout?: number }): Promise<string | null>;
  evaluate(fn: (node: any) => unknown): Promise<unknown>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
}

interface PWPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): PWLocator;
  evaluate(fn: () => unknown): Promise<unknown>;
  screenshot(options: { type: "jpeg"; quality: number }): Promise<Uint8Array>;
  waitForEvent(event: string, options?: { timeout?: number }): Promise<unknown>;
  waitForLoadState(state?: string, options?: { timeout?: number }): Promise<void>;
  close(): Promise<void>;
}

interface PWBrowser {
  newPage(options?: { viewport?: { width: number; height: number } }): Promise<PWPage>;
  close(): Promise<void>;
}

interface PWChromium {
  launch(options?: { headless?: boolean }): Promise<PWBrowser>;
}

/** What the page-summary evaluate() collects inside the browser. */
interface PageFacts {
  headings: string[];
  bodyText: string;
  clickables: string[];
}

/** The env_state JSON shape for browser runs (server<->web contract). */
export interface BrowserState {
  kind: "browser";
  url: string;
  title: string;
  steps: number;
  /** data:image/jpeg;base64,... viewport screenshot. */
  screenshot: string;
}

const normalize = (text: string): string => text.trim().toLowerCase();

export function createBrowserEnvironment(publishState: PublishState): RunEnvironment {
  let browser: PWBrowser | null = null;
  let page: PWPage | null = null;
  /** Cached so a failed launch reports the same error on every later tool. */
  let pagePromise: Promise<PWPage> | null = null;
  let steps = 0;

  async function launch(): Promise<PWPage> {
    let chromium: PWChromium;
    try {
      // Non-literal specifier: TS never resolves the module, so typechecking
      // passes with the dependency absent; Node resolves it at runtime.
      const specifier = "playwright";
      const mod = (await import(specifier)) as { chromium: PWChromium };
      chromium = mod.chromium;
    } catch (error) {
      throw new Error(
        `The "playwright" package is not installed (${describe(error)}). ` +
          "Run npm install, then npx playwright install chromium.",
      );
    }
    try {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage({ viewport: VIEWPORT });
      return page;
    } catch (error) {
      throw new Error(
        `Failed to launch headless Chromium (${describe(error)}). ` +
          "Install the browser binary with: npx playwright install chromium",
      );
    }
  }

  function ensurePage(): Promise<PWPage> {
    pagePromise ??= launch();
    return pagePromise;
  }

  /** Collect title/headings/text/clickables and format the summary block. */
  async function summarize(p: PWPage): Promise<string> {
    const facts = (await p.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((h) => (h as HTMLElement).innerText.trim())
        .filter(Boolean);
      const clickables = Array.from(document.querySelectorAll("a, button"))
        .map((el) => (el as HTMLElement).innerText.trim())
        .filter(Boolean);
      const bodyText = document.body ? document.body.innerText : "";
      return { headings, bodyText, clickables };
    })) as PageFacts;

    const text =
      facts.bodyText.length > PAGE_TEXT_MAX_CHARS
        ? `${facts.bodyText.slice(0, PAGE_TEXT_MAX_CHARS)}… (truncated)`
        : facts.bodyText;

    return [
      `URL: ${p.url()}`,
      `Title: ${await p.title()}`,
      `Headings: ${facts.headings.join(" | ") || "(none)"}`,
      `Clickable elements: ${facts.clickables.map((t) => `[${t}]`).join(" ") || "(none)"}`,
      "Page text:",
      text,
    ].join("\n");
  }

  /** Publish the browser env_state snapshot (called after goto/click succeed). */
  async function publishSnapshot(p: PWPage): Promise<void> {
    const shot = await p.screenshot({ type: "jpeg", quality: SCREENSHOT_QUALITY });
    const state: BrowserState = {
      kind: "browser",
      url: p.url(),
      title: await p.title(),
      steps,
      screenshot: `data:image/jpeg;base64,${Buffer.from(shot).toString("base64")}`,
    };
    publishState(state);
  }

  const goto: Tool = {
    name: "goto",
    description:
      `Navigate the browser to a URL. Only ${TARGET_ORIGIN} URLs are allowed — ` +
      "any other origin is blocked. Returns a summary of the resulting page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: `The URL to open (must be on ${TARGET_ORIGIN})` },
      },
      required: ["url"],
    },
    async execute(input: { url?: unknown }): Promise<ToolResult> {
      const url = typeof input?.url === "string" ? input.url.trim() : "";
      if (!url) return { output: "goto requires a url string", isError: true };
      // Origin allowlist BEFORE any browser work: blocked URLs never launch.
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { output: `Invalid URL: ${url}`, isError: true };
      }
      if (parsed.origin !== TARGET_ORIGIN) {
        return { output: ORIGIN_BLOCKED_MESSAGE, isError: true };
      }
      try {
        const p = await ensurePage();
        await p.goto(url, { waitUntil: "load" });
        steps += 1;
        await publishSnapshot(p);
        return { output: await summarize(p) };
      } catch (error) {
        return { output: describe(error), isError: true };
      }
    },
  };

  const readPage: Tool = {
    name: "read_page",
    description:
      "Summarize the current page: URL, title, headings, main visible text, and the clickable links/buttons by their visible text.",
    inputSchema: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      try {
        const p = await ensurePage();
        return { output: await summarize(p) };
      } catch (error) {
        return { output: describe(error), isError: true };
      }
    },
  };

  const click: Tool = {
    name: "click",
    description:
      "Click the first link or button whose visible text matches (case-insensitive, trimmed). Waits for any navigation or form submission it triggers, then returns a summary of the resulting page.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Visible text of the link/button to click" },
      },
      required: ["text"],
    },
    async execute(input: { text?: unknown }): Promise<ToolResult> {
      const wanted = typeof input?.text === "string" ? normalize(input.text) : "";
      if (!wanted) return { output: "click requires a text string", isError: true };
      try {
        const p = await ensurePage();
        const candidates = p.locator("a, button");
        const count = await candidates.count();
        let target: PWLocator | null = null;
        const seen: string[] = [];
        for (let i = 0; i < count && !target; i += 1) {
          const el = candidates.nth(i);
          const text = (await el.innerText().catch(() => "")).trim();
          if (text) seen.push(text);
          if (normalize(text) === wanted) target = el;
        }
        if (!target) {
          return {
            output:
              `No link or button with visible text "${input.text}" on this page. ` +
              `Available: ${seen.map((t) => `[${t}]`).join(" ") || "(none)"}`,
            isError: true,
          };
        }
        // Arm the navigation listener BEFORE clicking so a fast local
        // navigation (or form POST) is never missed; if the click navigates
        // nowhere the timeout resolves it quietly.
        const navigated = p
          .waitForEvent("framenavigated", { timeout: NAV_TIMEOUT_MS })
          .catch(() => null);
        await target.click();
        await navigated;
        await p.waitForLoadState("load").catch(() => {});
        steps += 1;
        await publishSnapshot(p);
        return { output: await summarize(p) };
      } catch (error) {
        return { output: describe(error), isError: true };
      }
    },
  };

  const fill: Tool = {
    name: "fill",
    description:
      "Fill the form input whose placeholder or label matches the field name (case-insensitive). Returns a confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        field: { type: "string", description: "Placeholder or label of the input to fill" },
        value: { type: "string", description: "Text to type into the input" },
      },
      required: ["field", "value"],
    },
    async execute(input: { field?: unknown; value?: unknown }): Promise<ToolResult> {
      const field = typeof input?.field === "string" ? input.field.trim() : "";
      const value = typeof input?.value === "string" ? input.value : null;
      if (!field || value === null) {
        return { output: "fill requires field and value strings", isError: true };
      }
      const wanted = normalize(field);
      try {
        const p = await ensurePage();
        const inputs = p.locator("input, textarea, select");
        const count = await inputs.count();
        for (let i = 0; i < count; i += 1) {
          const el = inputs.nth(i);
          const placeholder = (await el.getAttribute("placeholder")) ?? "";
          const ariaLabel = (await el.getAttribute("aria-label")) ?? "";
          const labelText = (await el
            .evaluate((node: any) =>
              node.labels && node.labels[0] ? String(node.labels[0].textContent) : "",
            )
            .catch(() => "")) as string;
          const matches = [placeholder, ariaLabel, labelText].some((candidate) => {
            const c = normalize(candidate);
            return c !== "" && (c === wanted || c.includes(wanted));
          });
          if (matches) {
            await el.fill(value);
            return { output: `Filled "${field}" with "${value}"` };
          }
        }
        return {
          output: `No input with placeholder or label matching "${field}" on this page.`,
          isError: true,
        };
      } catch (error) {
        return { output: describe(error), isError: true };
      }
    },
  };

  return {
    tools: [goto, readPage, click, fill],
    systemPrompt: SYSTEM_PROMPT,
    demoTask: BROWSER_DEMO_TASK,
    buildDemoScript: buildBrowserDemoScript,
    cleanup: () => {
      // Best-effort async teardown; the run is already finished.
      const p = page;
      const b = browser;
      page = null;
      browser = null;
      pagePromise = null;
      void (async () => {
        try {
          await p?.close();
        } catch {
          // Ignore — the page may already be gone with its browser.
        }
        try {
          await b?.close();
        } catch {
          // Ignore — nothing left to leak once the process owns no browser.
        }
      })();
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The happy-path QA script (eval task q1 and the manual mock demo): walks the
 * real shop home -> products -> add to cart -> fills the name -> clicks Place
 * order, observes the planted 500, and reports the bug with reproduction
 * steps. The final click's output contains "Internal Server Error (500)", so
 * the browser scorer marks this run a PASS.
 */
export function buildBrowserDemoScript(): MockStep[] {
  return [
    {
      thinking: "Start at the shop's home page to see the site structure.",
      toolCalls: [{ name: "goto", input: { url: "http://localhost:8788/" } }],
      delayMs: 700,
    },
    {
      thinking:
        "Home page is up with nav links to Products and Checkout. The checkout flow starts from a product, so browse the catalog first.",
      toolCalls: [{ name: "click", input: { text: "Products" } }],
      delayMs: 700,
    },
    {
      thinking:
        "Three products, each with an Add to cart link. Pick the first one to drive a realistic order.",
      text: "Adding the first product to the cart and heading to checkout.",
      toolCalls: [{ name: "click", input: { text: "Add to cart" } }],
      delayMs: 700,
    },
    {
      thinking:
        "On the checkout page with the item in the cart. The order form wants a name — fill it before submitting.",
      toolCalls: [{ name: "fill", input: { field: "Your name", value: "QA Bot" } }],
      delayMs: 650,
    },
    {
      thinking: "Form is filled. Submit the order and verify it succeeds.",
      toolCalls: [{ name: "click", input: { text: "Place order" } }],
      delayMs: 750,
    },
    {
      thinking:
        "The order submission returned an error page: Internal Server Error (500) with code ERR_ORDER_FAILED. The checkout flow is broken at the final step — that is the bug to report.",
      text: "BUG FOUND: placing an order always fails. Reproduction steps: 1) goto http://localhost:8788/ 2) click Products 3) click Add to cart on any product 4) fill the name field (placeholder \"Your name\") 5) click Place order. Expected: an order confirmation. Actual: the POST to /order responds with Internal Server Error (500) and error code ERR_ORDER_FAILED, so no order can ever be placed.",
      delayMs: 600,
    },
  ];
}

/**
 * The negative eval script (task q2): browses home and products, reads the
 * pages, but never exercises the order submission — so no click output ever
 * contains the 500 error and the browser scorer marks this run a FAIL.
 */
export function buildStuckBrowserScript(): MockStep[] {
  return [
    {
      thinking: "Open the shop's home page.",
      toolCalls: [{ name: "goto", input: { url: "http://localhost:8788/" } }],
      delayMs: 650,
    },
    {
      thinking: "Home looks fine. Check the page content in detail.",
      toolCalls: [{ name: "read_page", input: {} }],
      delayMs: 600,
    },
    {
      thinking: "Now look at the product catalog.",
      toolCalls: [{ name: "click", input: { text: "Products" } }],
      delayMs: 650,
    },
    {
      thinking: "Three products listed with prices. That all renders correctly.",
      toolCalls: [{ name: "read_page", input: {} }],
      delayMs: 600,
    },
    {
      text: "Everything looks fine — the home page and the product catalog load correctly and all links render. The shop appears to be working.",
      delayMs: 500,
    },
  ];
}
