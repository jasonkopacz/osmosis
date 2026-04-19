# Privacy Policy — Osmosis

**Last updated:** April 19, 2026

This policy describes how **Osmosis** (“we”, “us”), the browser extension and related online services, handles information when you use the product.

**Contact:** Replace this paragraph with your legal name or project name and a working email (for example `privacy@yourdomain.com`). Users may use that address for privacy-related requests.

---

## What Osmosis does

Osmosis helps you learn a language by replacing some words on web pages you visit with translations. Optional sign-in is used to authenticate you and to enforce fair use of translation features.

---

## Information processed in your browser

### Page content (local)

To choose words and show translations, the extension reads **visible text from the pages you visit** in your browser. That processing happens on your device so the extension can determine which words to send for translation.

### Extension storage (local)

The extension may store information in your browser, including:

- **Preferences** (for example, target language and how often to replace words), using Chrome’s sync or local storage as implemented in the product.
- **Authentication data** (for example, a session token issued by our service after you sign in).
- **Short-lived or cached data** needed for sign-in or to reduce repeated network requests (for example, cached profile or session details).

We do not use these local mechanisms to track your browsing across unrelated sites for advertising.

---

## Information collected by our servers

When you use features that require translation or an account, the extension communicates with our backend over HTTPS (see **Service providers** below for hosting). We may process:

### Account and authentication

- If you sign in with **Google**, Google shares with us the profile details needed to create and maintain your account (such as a verified email address and a stable Google subject identifier), consistent with Google’s OAuth disclosures and your Google account settings.
- We maintain a **user record** that may include your email address, account identifiers, subscription or plan information, and related metadata needed to run the service.

### Translation requests

- To translate words, the extension sends **the words to be translated** and the **target language** to our API. We use that content only to provide translations, enforce usage limits, improve caching, and operate the service.
- **Usage data:** We may record **aggregated usage** (for example, character or word volume per billing period) so we can enforce free-tier limits and understand service load.

### Translation caching

To make the service faster and more efficient, **word–translation pairs** may be stored in our databases or caches. Cached translations are generally **not tied to your identity** in the cache layer; they help avoid repeating the same translation work for many users.

### Payments (optional)

If you purchase a paid plan, **payment processing** is handled by our payment provider (for example, Stripe). We receive information needed to link your payment to your account and manage your subscription. We do not store full payment card numbers on our application servers; card data is handled by the payment provider under its terms and privacy policy.

---

## Service providers

We rely on service providers to run Osmosis, including:

- **Cloud infrastructure** (for example, Cloudflare) for hosting APIs, databases, and related services.
- **Microsoft Azure Translator** (or another translation provider we configure) to generate translations for text we send from our servers.
- **Google** for OAuth sign-in when you choose Google.
- **Stripe** (or another payment processor we enable) for subscriptions or paid plans.

Those providers process data under their own terms and privacy policies and only as needed to provide their services to us.

---

## What we do not do

- We do **not** sell your personal information.
- We do **not** load or execute **remote code** in the extension; extension logic is distributed inside the extension package. Network responses are used as data (for example, translation results), not as executable code.

---

## Legal bases and retention

We process information as needed to provide the service, secure accounts, meet legal obligations, and enforce our terms. **Retention periods** depend on the type of data (for example, account records while your account exists; usage records for billing or abuse prevention). You may request deletion of your account data as described below, subject to legal exceptions.

---

## Your choices and rights

Depending on where you live, you may have rights to **access**, **correct**, **delete**, or **export** personal information, or to **object** to certain processing. To exercise these rights, contact us using the email at the top of this policy. If you are in the European Economic Area, the United Kingdom, or Switzerland, you may also lodge a complaint with a supervisory authority.

---

## Children’s privacy

Osmosis is not directed at children under the age where parental consent is required in your region. We do not knowingly collect personal information from children.

---

## International transfers

If you use the service from outside the country where our providers operate, your information may be **transferred across borders** and protected as described by this policy and applicable law.

---

## Changes to this policy

We may update this policy from time to time. The **Last updated** date at the top will change when we do. For material changes, we may provide additional notice (for example, in the extension or by email when appropriate).

---

## Open source note

If you are viewing this file in a public source repository, replace the **Contact** section with your real contact details before linking this document from the Chrome Web Store or a production website.
