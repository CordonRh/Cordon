/**
 * Client-side crawler / lab-run detection — the same list as the server
 * `isBot()` (src/utils/is-bot.ts) and the root layout's head script, read
 * from `navigator.userAgent` so the page stays statically prerendered (a
 * `headers()` read on the route would opt it out).
 *
 * Only ever gates decoration a crawler has no use for: the preloader and the
 * WebGL particle stream. Content is the same for everyone.
 */
export const BOT_UA =
  /lighthouse|googlebot|pagespeed|headlesschrome|gtmetrix|pingdom|bingbot|yandexbot/i;

export const isBotClient = () =>
  typeof navigator !== "undefined" && BOT_UA.test(navigator.userAgent);
