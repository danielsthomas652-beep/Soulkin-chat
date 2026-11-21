'use strict';
/* mLT. chat — avatar parts: THE one shared whitelist for the avatar
 * maker. This single module is loaded by the browser (as the global
 * `AvatarParts`, via a plain <script> tag before app.js) AND required
 * by the server (server/index.js) to validate PATCH /api/me avatar
 * payloads. If a value isn't in these tables, it doesn't exist — the
 * client renderer only ever draws from these constants, and the server
 * only ever stores configs built from them, so a stored avatar can
 * never smuggle markup into anyone's page.
 *
 * A config is a compact JSON object of enum keys:
 *   { skin, hair, hairColor, mouth, facialHair,
 *     outfit, outfitColor, hat, glasses, bg }
 *
 * Art templates are SVG fragments on a 100x100 canvas, drawn for a
 * head centred at (50, 40) with radius 18. They use color tokens the
 * renderer substitutes with whitelisted hex values:
 *   {hc} hair color · {hd} hair, darkened · {hl} hair, lightened ·
 *   {oc} outfit color · {od} outfit, darkened · {ol} outfit, lightened ·
 *   {sk} skin tone · {sd} skin, darkened · {sl} skin, lightened
 * Every other color is baked into the template itself. Art is layered
 * (a darker under-layer, the main fill, a light sweep) so the little
 * portraits read as shaded cartoons, not flat cut-outs. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AvatarParts = api;
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---------- color tables (option key -> hex) ---------- */
  const SKIN_TONES = {
    skin1: '#ffe3c2', skin2: '#f7cfa5', skin3: '#eab086',
    skin4: '#d69a68', skin5: '#a96f3f', skin6: '#71431f',
  };
  const HAIR_COLORS = {
    black: '#26221f', brown: '#7a4a21', blonde: '#f2c14e', ginger: '#e07b39',
    red: '#c1442e', pink: '#ef6fb0', blue: '#3a6fd8', green: '#2fa36b',
    purple: '#7b61c9', gray: '#b8bcc4', white: '#f4f4f6',
  };
  const OUTFIT_COLORS = {
    red: '#e23b4e', blue: '#3a6fd8', green: '#2fa36b', purple: '#7b61c9',
    orange: '#f07818', pink: '#ef6fb0', yellow: '#f5b921', teal: '#14b8a6',
    black: '#33333d', white: '#eef0f4',
  };

  /* ---------- backgrounds (little scenes, drawn first) ---------- */
  const BACKGROUNDS = {
    plain: '<rect width="100" height="100" fill="#dfe9f5"/><ellipse cx="24" cy="14" rx="48" ry="30" fill="#ffffff" opacity=".38"/><ellipse cx="90" cy="98" rx="54" ry="28" fill="#b7cde8" opacity=".38"/><ellipse cx="12" cy="88" rx="20" ry="12" fill="#ffffff" opacity=".22"/>',
    sky: '<rect width="100" height="100" fill="#aee3ff"/><circle cx="84" cy="16" r="13" fill="#ffd93b" opacity=".25"/><circle cx="84" cy="16" r="9.5" fill="#ffd93b" opacity=".45"/><circle cx="84" cy="16" r="6.8" fill="#ffe066"/><g fill="#ffffff" opacity=".95"><ellipse cx="17" cy="20" rx="8" ry="4.4"/><ellipse cx="24" cy="17.5" rx="9" ry="5.2"/><ellipse cx="30" cy="20.5" rx="6.5" ry="3.8"/></g><g fill="#ffffff" opacity=".75"><ellipse cx="47" cy="12" rx="5.5" ry="3"/><ellipse cx="52.5" cy="10" rx="6" ry="3.6"/><ellipse cx="57.5" cy="12.4" rx="4.5" ry="2.6"/></g><path d="M12 40 q2.6 -2.8 5.2 0 q2.6 -2.8 5.2 0" fill="none" stroke="#5b7ea6" stroke-width="1.5" stroke-linecap="round"/><path d="M82 44 q2.2 -2.4 4.4 0 q2.2 -2.4 4.4 0" fill="none" stroke="#5b7ea6" stroke-width="1.3" stroke-linecap="round"/>',
    sunset: '<rect width="100" height="100" fill="#ff8c42"/><rect y="30" width="100" height="70" fill="#ff6b81" opacity=".5"/><rect y="56" width="100" height="44" fill="#d65076" opacity=".45"/><rect y="76" width="100" height="24" fill="#7b3f6d" opacity=".4"/><circle cx="50" cy="60" r="15" fill="#ffd93b" opacity=".22"/><circle cx="50" cy="60" r="10.5" fill="#ffd93b" opacity=".5"/><circle cx="50" cy="60" r="7.5" fill="#ffe27a"/><g fill="#8f3a5b" opacity=".5"><ellipse cx="15" cy="22" rx="8" ry="3.8"/><ellipse cx="21" cy="19.5" rx="7" ry="3.4"/></g><g fill="#8f3a5b" opacity=".4"><ellipse cx="80" cy="14" rx="7" ry="3.2"/><ellipse cx="86" cy="11.8" rx="6" ry="3"/></g>',
    beach: '<rect width="100" height="100" fill="#aee3ff"/><circle cx="15" cy="14" r="10" fill="#ffd93b" opacity=".3"/><circle cx="15" cy="14" r="6.5" fill="#ffe066"/><rect y="45" width="100" height="14" fill="#4db2e8"/><rect y="57" width="100" height="43" fill="#ffe3ae"/><rect y="76" width="100" height="24" fill="#f7d08a" opacity=".55"/><path d="M0 57 q12.5 -6 25 0 t25 0 t25 0 t25 0" fill="none" stroke="#ffffff" stroke-width="2.6" opacity=".9"/><path d="M0 64 q12.5 -5 25 0 t25 0 t25 0 t25 0" fill="none" stroke="#ffffff" stroke-width="2" opacity=".5"/><circle cx="10" cy="88" r="1.8" fill="#e8a87c"/><circle cx="90" cy="92" r="1.8" fill="#e8a87c"/><circle cx="84" cy="84" r="1.3" fill="#e8a87c"/>',
    forest: '<rect width="100" height="100" fill="#bfe8c8"/><circle cx="50" cy="8" r="17" fill="#fff3b0" opacity=".45"/><g fill="#57b877"><polygon points="-4,100 10,50 24,100"/><polygon points="76,100 90,50 104,100"/></g><g fill="#2e7d4f"><polygon points="-2,100 13,56 27,100"/><rect x="11" y="86" width="4.4" height="14" fill="#7a4a21"/><polygon points="73,100 87,52 101,100"/><rect x="85" y="84" width="4.4" height="16" fill="#7a4a21"/></g><g fill="#2e7d4f" opacity=".85"><polygon points="20,100 27,74 34,100"/><polygon points="66,100 73,74 80,100"/></g><circle cx="30" cy="30" r="1.4" fill="#ffffff" opacity=".7"/><circle cx="72" cy="24" r="1.4" fill="#ffffff" opacity=".7"/>',
    rainbow: '<rect width="100" height="100" fill="#aee3ff"/><g fill="none" stroke-width="11"><circle cx="50" cy="112" r="88" stroke="#ef476f"/><circle cx="50" cy="112" r="76" stroke="#f78c6b"/><circle cx="50" cy="112" r="64" stroke="#ffd93b"/><circle cx="50" cy="112" r="52" stroke="#06d6a0"/><circle cx="50" cy="112" r="40" stroke="#118ab2"/></g><circle cx="88" cy="13" r="6" fill="#ffe066"/><g fill="#ffffff"><ellipse cx="6" cy="95" rx="13" ry="6.5"/><ellipse cx="14" cy="91" rx="10" ry="5.5"/><ellipse cx="94" cy="95" rx="13" ry="6.5"/><ellipse cx="86" cy="91" rx="10" ry="5.5"/></g>',
    night: '<rect width="100" height="100" fill="#1d2a52"/><circle cx="81" cy="17" r="12" fill="#ffe9a3" opacity=".14"/><circle cx="81" cy="17" r="8" fill="#ffe9a3"/><circle cx="77.5" cy="14" r="6.4" fill="#1d2a52"/><g fill="#ffffff"><circle cx="14" cy="13" r="1.6"/><circle cx="31" cy="25" r="1.2"/><circle cx="57" cy="9" r="1.4"/><circle cx="21" cy="41" r="1.1" opacity=".8"/><circle cx="91" cy="40" r="1.2" opacity=".85"/><circle cx="66" cy="30" r="1" opacity=".8"/><circle cx="8" cy="58" r="1.1" opacity=".7"/></g><path d="M38 12 l1.1 2.9 2.9 1.1 -2.9 1.1 -1.1 2.9 -1.1 -2.9 -2.9 -1.1 2.9 -1.1 Z" fill="#ffe9a3"/><circle cx="13" cy="67" r="1.4" fill="#ffffff"/><path d="M15.2 65.4 L21.5 60.8" stroke="#ffffff" stroke-width="1.3" opacity=".5" stroke-linecap="round"/>',
    space: '<rect width="100" height="100" fill="#141b3d"/><g fill="#ffffff"><circle cx="12" cy="18" r="1.5"/><circle cx="33" cy="9" r="1.1"/><circle cx="63" cy="20" r="1.3"/><circle cx="25" cy="33" r="1" opacity=".8"/><circle cx="90" cy="34" r="1.1" opacity=".85"/><circle cx="70" cy="52" r="1" opacity=".7"/><circle cx="8" cy="46" r="1" opacity=".75"/></g><path d="M52 30 l.9 2.4 2.4.9 -2.4.9 -.9 2.4 -.9 -2.4 -2.4 -.9 2.4 -.9 Z" fill="#cdbcf7"/><circle cx="17" cy="66" r="3" fill="#e8e6ff" opacity=".9"/><circle cx="87" cy="74" r="10" fill="#b388ff"/><circle cx="84.5" cy="71.5" r="6" fill="#8e63d6" opacity=".45"/><ellipse cx="87" cy="74" rx="15.5" ry="4.2" fill="none" stroke="#ffd93b" stroke-width="2" transform="rotate(-14 87 74)"/>',
    mint: '<rect width="100" height="100" fill="#b8f1d4"/><ellipse cx="20" cy="12" rx="44" ry="26" fill="#ffffff" opacity=".3"/><g fill="#ffffff"><circle cx="16" cy="20" r="5" opacity=".4"/><circle cx="86" cy="30" r="7" opacity=".35"/><circle cx="24" cy="82" r="6" opacity=".35"/><circle cx="80" cy="86" r="4" opacity=".4"/><circle cx="66" cy="12" r="3" opacity=".4"/></g><circle cx="88" cy="62" r="6" fill="none" stroke="#ffffff" stroke-width="1.6" opacity=".35"/><ellipse cx="90" cy="100" rx="40" ry="18" fill="#5ec98f" opacity=".25"/>',
    pink: '<rect width="100" height="100" fill="#ffd3e6"/><ellipse cx="78" cy="10" rx="44" ry="26" fill="#ffffff" opacity=".32"/><g fill="#ffffff"><circle cx="18" cy="24" r="5" opacity=".45"/><circle cx="84" cy="18" r="6" opacity=".4"/><circle cx="78" cy="84" r="5" opacity=".45"/><circle cx="14" cy="76" r="4" opacity=".4"/><circle cx="34" cy="8" r="3" opacity=".45"/></g><circle cx="10" cy="52" r="6" fill="none" stroke="#ffffff" stroke-width="1.6" opacity=".35"/><ellipse cx="8" cy="100" rx="40" ry="18" fill="#ef6fb0" opacity=".2"/>',
    purple: '<rect width="100" height="100" fill="#cdbcf7"/><ellipse cx="22" cy="12" rx="44" ry="26" fill="#ffffff" opacity=".3"/><g fill="#ffffff"><circle cx="20" cy="16" r="5" opacity=".45"/><circle cx="84" cy="26" r="6" opacity=".4"/><circle cx="26" cy="86" r="6" opacity=".4"/><circle cx="82" cy="82" r="4" opacity=".45"/><circle cx="62" cy="8" r="3" opacity=".4"/></g><circle cx="90" cy="54" r="6" fill="none" stroke="#ffffff" stroke-width="1.6" opacity=".35"/><ellipse cx="88" cy="100" rx="40" ry="18" fill="#7b61c9" opacity=".22"/>',
  };

  /* ---------- hair (back = behind the body/head, front = over the forehead) ----------
   * Every style is layered: a darker {hd} under-layer offset down a
   * touch, the main {hc} fill, then a light {hl} sweep — flat caps
   * are banned. The shared cap silhouette hugs the head (centre
   * 50,40, r18) and spills a little past it for volume. */
  const CAPD = 'M29.5 43.5 A20.5 20.5 0 0 1 70.5 43.5 L70.5 35.5 C61.5 28.5 38.5 28.5 29.5 35.5 Z';
  const CAP_FRONT =
    `<path d="${CAPD}" fill="{hd}" transform="translate(0 1.4)"/><path d="${CAPD}" fill="{hc}"/>` +
    '<path d="M35.5 29.8 A16.5 14.5 0 0 1 54 23.6" fill="none" stroke="{hl}" stroke-width="3.2" stroke-linecap="round" opacity=".5"/>';
  const SPIKED = 'M29.8 45.5 L31.2 31.5 L37.2 38.5 L41.3 26.5 L46.3 35.5 L51.3 24.5 L56 34.3 L60.6 27 L64.2 35.8 L68.6 30.5 L69.8 45.5 L61.5 38.2 C55.8 34.6 44.2 34.6 38.5 38.2 Z';
  const HAIR_ART = {
    none: { back: '', front: '' },
    buzz: { back: '', front: '<path d="M30.8 43 A19.2 18.4 0 0 1 69.2 43 L69.2 39 C60.5 34 39.5 34 30.8 39 Z" fill="{hc}" opacity=".38"/><path d="M31.4 41.8 A18.6 17.6 0 0 1 68.6 41.8 A15 13.4 0 0 0 31.4 41.8 Z" fill="{hd}"/><path d="M32.2 40.9 A17.8 16.8 0 0 1 67.8 40.9 A14.4 12.8 0 0 0 32.2 40.9 Z" fill="{hc}"/><path d="M37.5 30.8 A13.5 11.5 0 0 1 51 25.9" fill="none" stroke="{hl}" stroke-width="2.4" stroke-linecap="round" opacity=".4"/>' },
    short: { back: '', front: CAP_FRONT },
    spiky: { back: '', front: '<path d="M30 45.5 A20 19.5 0 0 1 70 45.5 L70 39 C61 34.8 39 34.8 30 39 Z" fill="{hd}" transform="translate(0 1.2)"/><path d="M30 45.5 A20 19.5 0 0 1 70 45.5 L70 39 C61 34.8 39 34.8 30 39 Z" fill="{hc}"/>' + `<path d="${SPIKED}" fill="{hd}" transform="translate(0 1.3)"/><path d="${SPIKED}" fill="{hc}"/><path d="M41.3 26.5 L46.3 35.5 L42.2 36.8 Z" fill="{hd}" opacity=".5"/><path d="M56 34.3 L60.6 27 L61.8 36.4 Z" fill="{hd}" opacity=".5"/><path d="M51.3 24.5 L53.8 29.8 L49.6 30.4 Z" fill="{hl}" opacity=".75"/>` },
    mohawk: { back: '', front: '<path d="M41.8 36.5 C40.2 17.5 42.8 7 50 7 C57.2 7 59.8 17.5 58.2 36.5 C54.8 33.2 45.2 33.2 41.8 36.5 Z" fill="{hd}"/><path d="M44.3 35.8 C43.2 19.5 45.3 10.5 50 10.5 C54.7 10.5 56.8 19.5 55.7 35.8 C52.6 33.4 47.4 33.4 44.3 35.8 Z" fill="{hc}"/><path d="M47.8 13.2 C46.7 19.5 46.6 26 47.1 32.4" fill="none" stroke="{hl}" stroke-width="2.4" stroke-linecap="round" opacity=".55"/><path d="M31.6 41.5 A18.4 17.2 0 0 1 38.5 26.8 A15 13 0 0 0 33.8 40.8 Z" fill="{hd}" opacity=".32"/><path d="M68.4 41.5 A18.4 17.2 0 0 0 61.5 26.8 A15 13 0 0 1 66.2 40.8 Z" fill="{hd}" opacity=".32"/>' },
    curly: { back: '', front:
      '<path d="M30.5 43 A19.5 18.5 0 0 1 69.5 43 L69.5 37.5 C60.5 31 39.5 31 30.5 37.5 Z" fill="{hd}"/>' +
      '<g fill="{hd}"><circle cx="34" cy="34.9" r="5.6"/><circle cx="37.5" cy="28.4" r="6.2"/><circle cx="45.5" cy="24.9" r="6.6"/><circle cx="54.5" cy="24.9" r="6.6"/><circle cx="62.5" cy="28.4" r="6.2"/><circle cx="66" cy="34.9" r="5.6"/></g>' +
      '<g fill="{hc}"><circle cx="34" cy="34" r="5.6"/><circle cx="37.5" cy="27.5" r="6.2"/><circle cx="45.5" cy="24" r="6.6"/><circle cx="54.5" cy="24" r="6.6"/><circle cx="62.5" cy="27.5" r="6.2"/><circle cx="66" cy="34" r="5.6"/><circle cx="38" cy="36" r="4.4"/><circle cx="46" cy="34.6" r="4.6"/><circle cx="54" cy="34.6" r="4.6"/><circle cx="62" cy="36" r="4.4"/></g>' +
      '<g fill="{hl}" opacity=".8"><circle cx="35.5" cy="25" r="1.7"/><circle cx="43" cy="21.8" r="1.7"/><circle cx="52" cy="21.8" r="1.7"/><circle cx="60" cy="25.5" r="1.7"/></g>' },
    wavy: { back: '', front: '<path d="M29.5 43.5 A20.5 20.5 0 0 1 70.5 43.5 L70.5 36.5 C65.5 30.5 60.8 38.5 55.8 33.2 C51.2 38.8 46.2 31.2 41.2 36.8 C36.8 41.2 32.2 38.8 29.5 39.8 Z" fill="{hd}" transform="translate(0 1.3)"/><path d="M29.5 43.5 A20.5 20.5 0 0 1 70.5 43.5 L70.5 36.5 C65.5 30.5 60.8 38.5 55.8 33.2 C51.2 38.8 46.2 31.2 41.2 36.8 C36.8 41.2 32.2 38.8 29.5 39.8 Z" fill="{hc}"/><path d="M35 30.2 C41.5 25.8 51.5 25.2 59.5 28.8" fill="none" stroke="{hl}" stroke-width="2.8" stroke-linecap="round" opacity=".5"/>' },
    long: {
      back: '<path d="M21.5 88 L21 46 A24 22.5 0 0 1 79 46 L78.5 88 C78.4 92 71.8 91.8 71.2 87 L70.2 63.5 L29.8 63.5 L28.8 87 C28.2 91.8 21.6 92 21.5 88 Z" fill="{hd}"/><path d="M24.6 86.8 C24 70 24.2 54 26.2 41 L33 41 C31.8 55 31.5 70 32.2 85.6 C29.8 87.8 25.2 88.6 24.6 86.8 Z" fill="{hc}"/><path d="M75.4 86.8 C76 70 75.8 54 73.8 41 L67 41 C68.2 55 68.5 70 67.8 85.6 C70.2 87.8 74.8 88.6 75.4 86.8 Z" fill="{hc}"/><path d="M27.6 48 C27.2 59 27.2 70 27.8 80" fill="none" stroke="{hl}" stroke-width="2.1" stroke-linecap="round" opacity=".5"/><path d="M72.4 48 C72.8 59 72.8 70 72.2 80" fill="none" stroke="{hl}" stroke-width="2.1" stroke-linecap="round" opacity=".5"/>',
      front: CAP_FRONT,
    },
    ponytail: {
      back: '<ellipse cx="71.8" cy="56" rx="5.9" ry="15.5" fill="{hd}" transform="rotate(9 71.8 56)"/><ellipse cx="71" cy="55" rx="4.7" ry="14" fill="{hc}" transform="rotate(9 71 55)"/><path d="M68.6 44 C69.8 51.5 70.2 59 69.6 66.5" fill="none" stroke="{hl}" stroke-width="2.1" stroke-linecap="round" opacity=".5" transform="rotate(4 69.6 55)"/>',
      front: CAP_FRONT + '<circle cx="67.2" cy="34.8" r="3.1" fill="#e23b4e"/><circle cx="66.3" cy="33.9" r="1" fill="#ff8fa0"/>',
    },
    bun: { back: '', front: '<circle cx="50" cy="20" r="7.8" fill="{hd}"/><circle cx="50" cy="19.2" r="7" fill="{hc}"/><circle cx="47.4" cy="16.6" r="2.1" fill="{hl}" opacity=".7"/><circle cx="45.3" cy="14.8" r="1.1" fill="#ffd166"/><circle cx="54.7" cy="14.8" r="1.1" fill="#ffd166"/>' + CAP_FRONT },
  };

  /* ---------- faces: brows + mouth travel together ----------
   * Brows are slim filled lens shapes (tapered ends, never bars);
   * mouths carry teeth / tongue detail where the expression opens. */
  const MOUTH_INK = 'fill="none" stroke="#8a4b3a" stroke-width="2" stroke-linecap="round"';
  const BROW_L = '<path d="M38.7 35.6 Q43.4 32.4 48.3 35 Q43.4 34 38.7 35.6 Z" fill="#503a28"/>';
  const BROW_R = '<path d="M51.7 35 Q56.6 32.4 61.3 35.6 Q56.6 34 51.7 35 Z" fill="#503a28"/>';
  const BROW_L_HI = '<path d="M38.7 34.2 Q43.4 30.8 48.3 33.6 Q43.4 32.6 38.7 34.2 Z" fill="#503a28"/>';
  const BROW_R_HI = '<path d="M51.7 33.6 Q56.6 30.8 61.3 34.2 Q56.6 32.6 51.7 33.6 Z" fill="#503a28"/>';
  const MOUTH_ART = {
    smile: {
      brows: BROW_L + BROW_R,
      mouth: `<path d="M42.8 49.4 q7.2 5.6 14.4 0" ${MOUTH_INK}/><path d="M45.4 54.6 q4.6 2 9.2 0" fill="none" stroke="#8a4b3a" stroke-width="1.3" stroke-linecap="round" opacity=".35"/>`,
    },
    grin: {
      brows: BROW_L_HI + BROW_R_HI,
      mouth: '<path d="M40.9 47.3 h18.2 C59.1 53.6 55.1 56.9 50 56.9 C44.9 56.9 40.9 53.6 40.9 47.3 Z" fill="#7c3f31"/><path d="M41.8 48 h16.4 c-.5 2.9 -1.9 4.3 -3.9 4.3 H45.7 c-2 0 -3.4 -1.4 -3.9 -4.3 Z" fill="#ffffff"/><path d="M46.9 48.2 v3.6 M53.1 48.2 v3.6" stroke="#d9cfc9" stroke-width="1.1"/><ellipse cx="50" cy="55.4" rx="4.4" ry="1.6" fill="#ef6fb0"/><path d="M40.9 47.3 h18.2 C59.1 53.6 55.1 56.9 50 56.9 C44.9 56.9 40.9 53.6 40.9 47.3 Z" fill="none" stroke="#8a4b3a" stroke-width="1.7"/>',
    },
    laugh: {
      brows: BROW_L_HI + BROW_R_HI,
      mouth: '<ellipse cx="50" cy="52.4" rx="6.9" ry="5.5" fill="#7c3f31"/><path d="M43.9 49.6 A6.9 5.5 0 0 1 56.1 49.6 L55.7 52 C52.4 50.9 47.6 50.9 44.3 52 Z" fill="#ffffff"/><ellipse cx="50" cy="55.9" rx="4.1" ry="1.9" fill="#ef6fb0"/><ellipse cx="50" cy="52.4" rx="6.9" ry="5.5" fill="none" stroke="#8a4b3a" stroke-width="1.6"/>',
    },
    meh: {
      brows: '<path d="M38.8 35.2 Q43.5 33.7 48.2 35.2 Q43.5 34.4 38.8 35.2 Z" fill="#503a28"/><path d="M51.8 35.2 Q56.5 33.7 61.2 35.2 Q56.5 34.4 51.8 35.2 Z" fill="#503a28"/>',
      mouth: `<path d="M43.9 51.4 h12.2" ${MOUTH_INK}/>`,
    },
    wow: {
      brows: '<path d="M38.7 32.6 Q43.4 29.4 48.3 32 Q43.4 31 38.7 32.6 Z" fill="#503a28"/><path d="M51.7 32 Q56.6 29.4 61.3 32.6 Q56.6 31 51.7 32 Z" fill="#503a28"/>',
      mouth: '<circle cx="50" cy="52.2" r="4.1" fill="#7c3f31"/><ellipse cx="50" cy="54" rx="2.2" ry="1.3" fill="#ef6fb0"/><circle cx="50" cy="52.2" r="4.1" fill="none" stroke="#8a4b3a" stroke-width="1.5"/>',
    },
    smirk: {
      brows: BROW_L + '<path d="M51.9 35.9 Q56.6 34.3 61.1 35.3 Q56.6 34.7 51.9 35.9 Z" fill="#503a28"/>',
      mouth: `<path d="M42.7 50.4 q7.6 4.8 14.6 -1.4" ${MOUTH_INK}/><circle cx="57.6" cy="48.7" r=".95" fill="#8a4b3a"/>`,
    },
  };

  /* ---------- facial hair (drawn in the hair color, under the mouth) ----------
   * Layered like the hair: an {hd} under-layer, the {hc} body,
   * scalloped / strand texture so it reads as hair, not a bib. */
  const BEARD_D = 'M33.2 39.5 C33.6 53.5 40.9 64.2 50 64.2 C59.1 64.2 66.4 53.5 66.8 39.5 C63.4 50 58 55.4 50 55.4 C42 55.4 36.6 50 33.2 39.5 Z';
  const MUSTACHE_D = 'M50 47.2 C48.2 44.3 42 43.9 40.4 46.4 C39.1 48.5 40.9 50.6 43.3 50.4 C46 50.2 48.6 49 50 47.2 C51.4 49 54 50.2 56.7 50.4 C59.1 50.6 60.9 48.5 59.6 46.4 C58 43.9 51.8 44.3 50 47.2 Z';
  const GOATEE_D = 'M42.4 52.6 C43.3 59 46.2 63 50 63 C53.8 63 56.7 59 57.6 52.6 C55.2 54.7 52.7 55.6 50 55.6 C47.3 55.6 44.8 54.7 42.4 52.6 Z';
  const FACIAL_HAIR_ART = {
    none: '',
    mustache: `<path d="${MUSTACHE_D}" fill="{hd}" transform="translate(0 .9)"/><path d="${MUSTACHE_D}" fill="{hc}"/><path d="M42.8 46.2 C44.8 44.9 47.2 44.7 48.8 45.7" fill="none" stroke="{hl}" stroke-width="1.3" stroke-linecap="round" opacity=".5"/>`,
    beard: `<path d="${BEARD_D}" fill="{hd}" transform="translate(0 1)"/><path d="${BEARD_D}" fill="{hc}"/><circle cx="41" cy="61.8" r="3.1" fill="{hc}"/><circle cx="50" cy="63.4" r="3.3" fill="{hc}"/><circle cx="59" cy="61.8" r="3.1" fill="{hc}"/><path d="M43 56.5 v4.2 M50 57.5 v4.6 M57 56.5 v4.2" stroke="{hd}" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>`,
    goatee: `<path d="${GOATEE_D}" fill="{hd}" transform="translate(0 .9)"/><path d="${GOATEE_D}" fill="{hc}"/><circle cx="50" cy="62.2" r="2.7" fill="{hc}"/><path d="M50 57 v4" stroke="{hd}" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>`,
    stubble: `<path d="${BEARD_D}" fill="{hc}" opacity=".24"/><g fill="{hc}" opacity=".5"><circle cx="38" cy="52" r=".6"/><circle cx="42" cy="57" r=".6"/><circle cx="47" cy="60" r=".6"/><circle cx="53" cy="60" r=".6"/><circle cx="58" cy="57" r=".6"/><circle cx="62" cy="52" r=".6"/><circle cx="44" cy="53" r=".55"/><circle cx="56" cy="53" r=".55"/><circle cx="50" cy="61.5" r=".55"/><circle cx="36.5" cy="46" r=".55"/><circle cx="63.5" cy="46" r=".55"/></g>`,
  };

  /* ---------- outfits (back = cape/hood behind the torso, front = the torso itself) ----------
   * Every outfit is built, not just filled: collars, seams, zips,
   * pockets and trims in the derived {od}/{ol} shades. */
  const TORSO = 'M14 100 C14 76 30 66 50 66 C70 66 86 76 86 100 Z';
  const OUTFIT_ART = {
    tshirt: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M21.5 75.5 C27 69.8 34 67 41 66.5 M78.5 75.5 C73 69.8 66 67 59 66.5" fill="none" stroke="{od}" stroke-width="1.7" opacity=".75"/><path d="M41.2 66.4 A9.6 6.2 0 0 0 58.8 66.4 L55.9 71.6 A7.3 4.5 0 0 1 44.1 71.6 Z" fill="{od}"/><path d="M44.3 68.4 A6.8 4.2 0 0 0 55.7 68.4" fill="none" stroke="{ol}" stroke-width="1.5" opacity=".85"/><rect x="59.5" y="81.5" width="9.5" height="8.5" rx="1.7" fill="{od}" opacity=".45"/><path d="M59.5 83.8 h9.5" stroke="{od}" stroke-width="1.2" opacity=".6"/>`,
    },
    hoodie: {
      back: '<path d="M33.5 70.5 A16.5 12.5 0 0 1 66.5 70.5 L62.8 76.5 A12.8 9 0 0 0 37.2 76.5 Z" fill="{od}"/><path d="M38 68.8 A12.5 9.5 0 0 1 62 68.8" fill="none" stroke="{ol}" stroke-width="1.6" opacity=".6"/>',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M37.8 66.6 A12.2 8.2 0 0 1 62.2 66.6 L59.2 73.6 A9.6 6.2 0 0 0 40.8 73.6 Z" fill="{od}"/><path d="M46.3 72.2 L45.2 79.8 M53.7 72.2 L54.8 79.8" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/><circle cx="45.1" cy="80.6" r="1.15" fill="#ffffff"/><circle cx="54.9" cy="80.6" r="1.15" fill="#ffffff"/><path d="M36.5 85.5 h27 v10.5 a3.5 3.5 0 0 1 -3.5 3.5 h-20 a3.5 3.5 0 0 1 -3.5 -3.5 Z" fill="{od}" opacity=".42"/><path d="M36.5 85.5 L42 92 M63.5 85.5 L58 92" stroke="{od}" stroke-width="1.6" opacity=".6"/>`,
    },
    jacket: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M42.8 66 L57.2 66 L50 100 Z" fill="#f4f6f9"/><path d="M50 74 L50 99" stroke="#d5dde8" stroke-width="1.4"/><path d="M42.8 66 L50 86 L39.8 75.5 C40.6 71 41.5 68 42.8 66 Z" fill="{od}"/><path d="M57.2 66 L50 86 L60.2 75.5 C59.4 71 58.5 68 57.2 66 Z" fill="{od}"/><path d="M43.4 67.5 L49.6 84.5 M56.6 67.5 L50.4 84.5" stroke="{ol}" stroke-width="1.1" opacity=".5" fill="none"/><path d="M40.5 65.8 h19 L57 69.5 h-14 Z" fill="{od}"/><rect x="23.5" y="85" width="9.5" height="6" rx="1.5" fill="{od}" opacity=".5"/><rect x="67" y="85" width="9.5" height="6" rx="1.5" fill="{od}" opacity=".5"/>`,
    },
    sweater: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M16.6 79.8 C30 76.4 70 76.4 83.4 79.8 L83.6 85 C70 82 30 82 16.4 85 Z" fill="{ol}" opacity=".8"/><path d="M16.4 89.8 C30 86.4 70 86.4 83.6 89.8 L83.8 95 C70 92 30 92 16.2 95 Z" fill="{ol}" opacity=".8"/><path d="M41.2 66.4 A9.6 6.2 0 0 0 58.8 66.4 L56.2 70.8 A7.4 4.6 0 0 1 43.8 70.8 Z" fill="{od}"/><path d="M45 67.2 v3 M48.3 67.4 v3.2 M51.7 67.4 v3.2 M55 67.2 v3" stroke="{oc}" stroke-width="1.3" opacity=".8"/><path d="M15 95.5 C30 93 70 93 85 95.5 L85.2 100 L14.8 100 Z" fill="{od}" opacity=".45"/>`,
    },
    suit: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M43.2 66 L56.8 66 L50 85 Z" fill="#ffffff"/><path d="M41 66 L50 88 L38.6 75.8 C39.3 71.5 40 68.2 41 66 Z" fill="{od}"/><path d="M59 66 L50 88 L61.4 75.8 C60.7 71.5 60 68.2 59 66 Z" fill="{od}"/><rect x="47.9" y="66.1" width="4.2" height="4.6" rx="1.1" fill="#c2273a"/><path d="M50 70.7 L53.3 74.8 L51.4 85 L48.6 85 L46.7 74.8 Z" fill="#e23b4e"/><path d="M50 70.7 L53.3 74.8 L51.4 85 L50 85 Z" fill="#c2273a" opacity=".5"/><path d="M50 88.5 L50 100" stroke="{od}" stroke-width="1.7"/><circle cx="53.4" cy="93" r="1.25" fill="{od}"/><rect x="62.8" y="79.5" width="5.6" height="3.1" fill="#ffffff" opacity=".92"/>`,
    },
    superhero: {
      back: '<path d="M16.5 66.5 C5.5 77 3 89 5 100 L15.8 100 C13.2 88 14.8 76.5 20 70.5 Z" fill="#d92638"/><path d="M83.5 66.5 C94.5 77 97 89 95 100 L84.2 100 C86.8 88 85.2 76.5 80 70.5 Z" fill="#d92638"/><path d="M10 78 C8.6 85 8.8 92 10.2 99 M90 78 C91.4 85 91.2 92 89.8 99" stroke="#a31325" stroke-width="1.7" fill="none" opacity=".7"/>',
      front: `<path d="${TORSO}" fill="{oc}"/><ellipse cx="50" cy="69" rx="30" ry="8" fill="{ol}" opacity=".22"/><circle cx="50" cy="82.5" r="7.6" fill="#ffd166" stroke="{od}" stroke-width="1.6"/><circle cx="50" cy="82.5" r="5.7" fill="none" stroke="#ffffff" stroke-width="1.1" opacity=".55"/><path d="M51.7 76.8 L46.9 84 L50.2 84 L48.5 88.9 L54.1 81.2 L50.8 81.2 Z" fill="{od}"/><path d="M15.3 93.2 C30 90.3 70 90.3 84.7 93.2 L85 100 L15 100 Z" fill="#ffd166"/><rect x="45.8" y="91.6" width="8.4" height="5.6" rx="1.5" fill="{od}"/>`,
    },
    overalls: {
      back: '',
      front: `<path d="${TORSO}" fill="{oc}"/><path d="M14 100 C14 84.5 19.8 75.2 29.5 69.2 L29.5 100 Z" fill="#3a6fd8"/><path d="M86 100 C86 84.5 80.2 75.2 70.5 69.2 L70.5 100 Z" fill="#3a6fd8"/><rect x="38.8" y="77.5" width="22.4" height="22.5" fill="#3a6fd8"/><rect x="39.8" y="65.8" width="6.2" height="13.5" fill="#3a6fd8"/><rect x="54" y="65.8" width="6.2" height="13.5" fill="#3a6fd8"/><path d="M41 67 v11 M57 67 v11" stroke="#2b4f9e" stroke-width="1.3" opacity=".7"/><rect x="41.2" y="80" width="17.6" height="17" fill="none" stroke="#ffd166" stroke-width="1" stroke-dasharray="2.4 2" opacity=".75"/><rect x="44.6" y="85.5" width="10.8" height="9" fill="#2b4f9e" opacity=".6"/><path d="M44.6 85.5 h10.8" stroke="#ffd166" stroke-width="1" stroke-dasharray="2.4 2" opacity=".75"/><circle cx="43" cy="79.3" r="2" fill="#ffd166"/><circle cx="57" cy="79.3" r="2" fill="#ffd166"/><circle cx="43" cy="79.3" r=".8" fill="#b8860b"/><circle cx="57" cy="79.3" r=".8" fill="#b8860b"/>`,
    },
    tank: {
      back: '',
      front: `<path d="${TORSO}" fill="{sk}"/><path d="M23.8 73 C21.8 80 21.4 89 22 98 M76.2 73 C78.2 80 78.6 89 78 98" fill="none" stroke="{sd}" stroke-width="1.7" opacity=".45"/><path d="M25.5 100 C25.5 79.5 35.5 67.8 50 67.8 C64.5 67.8 74.5 79.5 74.5 100 Z" fill="{oc}"/><path d="M41.2 68.2 A9.6 6 0 0 0 58.8 68.2 L55.9 73.2 A7.3 4.5 0 0 1 44.1 73.2 Z" fill="{od}"/><path d="M27.5 84 C27.8 90 28 95 28.2 100 M72.5 84 C72.2 90 72 95 71.8 100" fill="none" stroke="{od}" stroke-width="1.5" opacity=".55"/><path d="M25.6 94.5 C35 92.8 65 92.8 74.4 94.5 L74.5 100 L25.5 100 Z" fill="{od}" opacity=".32"/>`,
    },
  };

  /* ---------- hats (fixed colors, drawn over the hair) ----------
   * Shaded bodies, bands, seams and sheens — and each sits on a soft
   * shadow so it rests on the head instead of floating. */
  const HAT_ART = {
    none: '',
    cap: '<ellipse cx="50" cy="38.2" rx="21" ry="3.2" fill="#000000" opacity=".10"/><path d="M29.8 36.8 A20.2 16.2 0 0 1 70.2 36.8 Z" fill="#e23b4e"/><path d="M55 21.2 A20.2 16.2 0 0 1 70.2 36.8 L55 36.8 Z" fill="#c2273a" opacity=".65"/><path d="M50 20.8 L50 36.5 M37.8 24.2 C40.8 28.8 42.3 32.2 42.8 36.5 M62.2 24.2 C59.2 28.8 57.7 32.2 57.2 36.5" fill="none" stroke="#b31e30" stroke-width="1.3" opacity=".7"/><ellipse cx="50" cy="38.6" rx="25.5" ry="4.9" fill="#c2273a"/><ellipse cx="50" cy="37.4" rx="25.5" ry="4.3" fill="#e23b4e"/><circle cx="50" cy="20.6" r="2.5" fill="#c2273a"/><circle cx="49.2" cy="19.8" r=".9" fill="#ff8fa0"/>',
    beanie: '<path d="M29.8 34 A20.2 17 0 0 1 70.2 34 L70.2 37 L29.8 37 Z" fill="#3a6fd8"/><path d="M37 21.5 L37.4 33.5 M44 18.8 L44.2 33.5 M50.8 18.2 L50.8 33.5 M57.6 18.8 L57.4 33.5 M64 21.5 L63.6 33.5" stroke="#2b4f9e" stroke-width="1.7" opacity=".55"/><rect x="28.8" y="33" width="42.4" height="7" rx="3.5" fill="#2b4f9e"/><path d="M34 35.2 v3.6 M39 35.2 v3.6 M44 35.2 v3.6 M49 35.2 v3.6 M54 35.2 v3.6 M59 35.2 v3.6 M64 35.2 v3.6" stroke="#3a6fd8" stroke-width="1.5" opacity=".85"/><circle cx="50" cy="15.6" r="4.9" fill="#ffffff"/><circle cx="48.2" cy="14" r="1.5" fill="#dbe4f2"/><circle cx="52" cy="17.4" r="1.2" fill="#dbe4f2"/>',
    cowboy: '<ellipse cx="50" cy="36.6" rx="26.5" ry="5.3" fill="#b07a3f"/><ellipse cx="50" cy="35.5" rx="26.5" ry="4.7" fill="#c08b4e"/><path d="M36.2 35.8 L36.9 26.8 A13.3 9.2 0 0 1 63.1 26.8 L63.8 35.8 Z" fill="#c08b4e"/><path d="M43.8 20.6 C45.8 24.2 54.2 24.2 56.2 20.6 C55 26.8 45 26.8 43.8 20.6 Z" fill="#a06a34"/><rect x="36.5" y="30.4" width="27" height="4.6" fill="#7a4a21"/><rect x="47.5" y="30.8" width="5" height="3.8" rx=".8" fill="#ffd166"/>',
    crown: '<polygon points="34.5,34.5 34.5,19 42.5,27.5 50,15.5 57.5,27.5 65.5,19 65.5,34.5" fill="#f5b921"/><polygon points="50,15.5 57.5,27.5 65.5,19 65.5,34.5 50,34.5" fill="#eaa50f" opacity=".65"/><polygon points="34.5,34.5 34.5,19 42.5,27.5 50,15.5 57.5,27.5 65.5,19 65.5,34.5" fill="none" stroke="#d9930d" stroke-width="1.4" stroke-linejoin="round"/><rect x="34.5" y="30.6" width="31" height="3.9" fill="#d9930d"/><circle cx="41.5" cy="28.2" r="1.9" fill="#118ab2"/><circle cx="50" cy="26.8" r="2.3" fill="#e23b4e"/><circle cx="58.5" cy="28.2" r="1.9" fill="#06d6a0"/><g fill="#ffffff" opacity=".75"><circle cx="39" cy="32.5" r=".85"/><circle cx="45.7" cy="32.5" r=".85"/><circle cx="54.3" cy="32.5" r=".85"/><circle cx="61" cy="32.5" r=".85"/></g>',
    party: '<polygon points="37.5,33.8 50,7.2 62.5,33.8" fill="#ef6fb0"/><polygon points="44.6,19.2 55.4,19.2 57.6,24 42.4,24" fill="#ffffff" opacity=".9"/><polygon points="40.8,27.2 59.2,27.2 61.4,31.8 38.6,31.8" fill="#ffd166" opacity=".95"/><circle cx="47" cy="15" r="1.8" fill="#ffffff" opacity=".9"/><circle cx="53.5" cy="30" r="1.6" fill="#ffffff" opacity=".85"/><circle cx="50" cy="7" r="3.9" fill="#ffd166"/><circle cx="48.6" cy="5.8" r="1.4" fill="#ffe9a3"/><ellipse cx="50" cy="34.2" rx="13.8" ry="2.7" fill="#d14f8d"/>',
    tophat: '<ellipse cx="50" cy="33.4" rx="25.5" ry="4.9" fill="#232329"/><ellipse cx="50" cy="32.5" rx="25.5" ry="4.4" fill="#3a3a44"/><rect x="35.5" y="6.5" width="29" height="26" fill="#2b2b33"/><rect x="39" y="7" width="6" height="25" fill="#ffffff" opacity=".13"/><rect x="57.5" y="7" width="6" height="25" fill="#000000" opacity=".16"/><rect x="35.5" y="25" width="29" height="6" fill="#e23b4e"/><rect x="35.5" y="29.8" width="29" height="1.4" fill="#b31e30"/>',
    wizard: '<polygon points="33.5,34.8 55.5,4.5 64.5,34.8" fill="#4b3a8f"/><polygon points="55.5,4.5 64.5,34.8 51,34.8" fill="#3a2c70" opacity=".75"/><polygon points="51.5,14.5 52.9,18.1 56.7,18.3 53.7,20.6 54.7,24.3 51.5,22.2 48.3,24.3 49.3,20.6 46.3,18.3 50.1,18.1" fill="#ffd166"/><circle cx="43.5" cy="26.5" r="2.3" fill="#ffd166"/><circle cx="44.6" cy="25.6" r="1.9" fill="#4b3a8f"/><circle cx="58.5" cy="27.5" r="1.3" fill="#ffd166"/><ellipse cx="50" cy="35.8" rx="24" ry="4.7" fill="#3a2c70"/><ellipse cx="50" cy="34.9" rx="24" ry="4.2" fill="#4b3a8f"/>',
  };

  /* ---------- glasses (drawn last, over the eyes) ----------
   * Frames carry a diagonal glare streak so the lenses read as
   * glass; shades and sport lenses get the same treatment, darker. */
  const GLASS_INK = 'fill="rgba(255,255,255,.10)" stroke="#33383f" stroke-width="2"';
  const GLASSES_ART = {
    none: '',
    round: `<circle cx="43.3" cy="40.5" r="6.3" ${GLASS_INK}/><circle cx="56.7" cy="40.5" r="6.3" ${GLASS_INK}/><path d="M49.6 40 h.8 M37 39.2 L31.8 38.2 M63 39.2 L68.2 38.2" stroke="#33383f" stroke-width="2" fill="none"/><path d="M39.8 36.8 L43.6 36.4 L41 43.8 L38.6 44.1 Z" fill="#ffffff" opacity=".4"/><path d="M53.2 36.8 L57 36.4 L54.4 43.8 L52 44.1 Z" fill="#ffffff" opacity=".4"/>`,
    square: `<rect x="36" y="33.8" width="14.6" height="13.2" rx="2.6" ${GLASS_INK}/><rect x="49.4" y="33.8" width="14.6" height="13.2" rx="2.6" ${GLASS_INK}/><path d="M36 38.2 L31.6 37.2 M64 38.2 L68.4 37.2" stroke="#33383f" stroke-width="2" fill="none"/><path d="M38.4 36 L42.6 35.6 L40 44.4 L37.2 44.8 Z" fill="#ffffff" opacity=".38"/><path d="M51.8 36 L56 35.6 L53.4 44.4 L50.6 44.8 Z" fill="#ffffff" opacity=".38"/>`,
    shades: '<path d="M35.4 34.3 h15.4 v6 a7.7 6.6 0 0 1 -15.4 0 Z" fill="#20242b"/><path d="M49.2 34.3 h15.4 v6 a7.7 6.6 0 0 1 -15.4 0 Z" fill="#20242b"/><path d="M50.8 37 h-1.6 M35.4 36.6 L31.2 35.4 M64.6 36.6 L68.8 35.4" stroke="#20242b" stroke-width="2.2" fill="none"/><path d="M37.6 36.4 L44.4 35.8 L40.8 42.4 L36.4 42.8 Z" fill="#ffffff" opacity=".32"/><path d="M51 36.4 L57.8 35.8 L54.2 42.4 L49.8 42.8 Z" fill="#ffffff" opacity=".32"/>',
    hearts: '<path d="M43.3 47.4 C38 43 36 40 36 37.2 A4.4 4.4 0 0 1 43.3 34.5 A4.4 4.4 0 0 1 50.6 37.2 C50.6 40 48.6 43 43.3 47.4 Z" fill="#ef476f" stroke="#d1345b" stroke-width="1.3"/><path d="M56.7 47.4 C51.4 43 49.4 40 49.4 37.2 A4.4 4.4 0 0 1 56.7 34.5 A4.4 4.4 0 0 1 64 37.2 C64 40 62 43 56.7 47.4 Z" fill="#ef476f" stroke="#d1345b" stroke-width="1.3"/><circle cx="40.2" cy="37.6" r="1.25" fill="#ffffff" opacity=".85"/><circle cx="53.6" cy="37.6" r="1.25" fill="#ffffff" opacity=".85"/><path d="M49.9 39.5 h.2" stroke="#d1345b" stroke-width="1.6"/>',
    stars: '<polygon points="43.3,33.8 45.4,38.6 50.6,38.8 46.7,41.9 47.9,46.9 43.3,43.9 38.7,46.9 39.9,41.9 36,38.8 41.2,38.6" fill="#f5b921" stroke="#d9930d" stroke-width="1.1" stroke-linejoin="round"/><polygon points="56.7,33.8 58.8,38.6 63.8,38.8 60,41.9 61.2,46.9 56.7,43.9 52.2,46.9 53.4,41.9 49.5,38.8 54.7,38.6" fill="#f5b921" stroke="#d9930d" stroke-width="1.1" stroke-linejoin="round"/><circle cx="40.8" cy="37.4" r="1.05" fill="#ffffff" opacity=".85"/><circle cx="54.2" cy="37.4" r="1.05" fill="#ffffff" opacity=".85"/>',
    sport: '<path d="M34.2 34.8 h31.6 v6.6 a31.6 7.2 0 0 1 -31.6 0 Z" fill="#118ab2" opacity=".94"/><path d="M37.4 36.6 L55 35.9 L51.8 41.6 L36.2 42.4 Z" fill="#ffffff" opacity=".3"/><path d="M34.2 41.4 a31.6 7.2 0 0 0 31.6 0" fill="none" stroke="#0b6e8f" stroke-width="1.5"/>',
  };

  /* ---------- the whitelist itself ---------- */
  const AVATAR_KEYS = ['skin', 'hair', 'hairColor', 'mouth', 'facialHair', 'outfit', 'outfitColor', 'hat', 'glasses', 'bg'];
  const AVATAR_OPTIONS = {
    skin: Object.keys(SKIN_TONES),
    hair: Object.keys(HAIR_ART),
    hairColor: Object.keys(HAIR_COLORS),
    mouth: Object.keys(MOUTH_ART),
    facialHair: Object.keys(FACIAL_HAIR_ART),
    outfit: Object.keys(OUTFIT_ART),
    outfitColor: Object.keys(OUTFIT_COLORS),
    hat: Object.keys(HAT_ART),
    glasses: Object.keys(GLASSES_ART),
    bg: Object.keys(BACKGROUNDS),
  };
  const AVATAR_DEFAULTS = {
    skin: 'skin2', hair: 'short', hairColor: 'brown', mouth: 'smile',
    facialHair: 'none', outfit: 'tshirt', outfitColor: 'blue',
    hat: 'none', glasses: 'none', bg: 'sky',
  };
  /* Creator categories, in display order, with 1-2 word option labels. */
  const AVATAR_CATEGORIES = [
    { key: 'skin', label: 'Skin', options: [
      { key: 'skin1', label: 'Pale' }, { key: 'skin2', label: 'Light' }, { key: 'skin3', label: 'Tan' },
      { key: 'skin4', label: 'Honey' }, { key: 'skin5', label: 'Bronze' }, { key: 'skin6', label: 'Deep' }] },
    { key: 'hair', label: 'Hair', options: [
      { key: 'none', label: 'Bald' }, { key: 'buzz', label: 'Buzz' }, { key: 'short', label: 'Short' },
      { key: 'spiky', label: 'Spiky' }, { key: 'mohawk', label: 'Mohawk' }, { key: 'curly', label: 'Curly' },
      { key: 'wavy', label: 'Wavy' }, { key: 'long', label: 'Long' }, { key: 'ponytail', label: 'Ponytail' },
      { key: 'bun', label: 'Bun' }] },
    { key: 'hairColor', label: 'Hair color', options: [
      { key: 'black', label: 'Black' }, { key: 'brown', label: 'Brown' }, { key: 'blonde', label: 'Blonde' },
      { key: 'ginger', label: 'Ginger' }, { key: 'red', label: 'Red' }, { key: 'pink', label: 'Pink' },
      { key: 'blue', label: 'Blue' }, { key: 'green', label: 'Green' }, { key: 'purple', label: 'Purple' },
      { key: 'gray', label: 'Gray' }, { key: 'white', label: 'White' }] },
    { key: 'mouth', label: 'Face', options: [
      { key: 'smile', label: 'Smile' }, { key: 'grin', label: 'Grin' }, { key: 'laugh', label: 'Laugh' },
      { key: 'meh', label: 'Meh' }, { key: 'wow', label: 'Wow' }, { key: 'smirk', label: 'Smirk' }] },
    { key: 'facialHair', label: 'Beard', options: [
      { key: 'none', label: 'None' }, { key: 'mustache', label: 'Mustache' }, { key: 'beard', label: 'Beard' },
      { key: 'goatee', label: 'Goatee' }, { key: 'stubble', label: 'Stubble' }] },
    { key: 'outfit', label: 'Clothes', options: [
      { key: 'tshirt', label: 'T-Shirt' }, { key: 'hoodie', label: 'Hoodie' }, { key: 'jacket', label: 'Jacket' },
      { key: 'sweater', label: 'Sweater' }, { key: 'suit', label: 'Suit' }, { key: 'superhero', label: 'Hero' },
      { key: 'overalls', label: 'Overalls' }, { key: 'tank', label: 'Tank top' }] },
    { key: 'outfitColor', label: 'Color', options: [
      { key: 'red', label: 'Red' }, { key: 'blue', label: 'Blue' }, { key: 'green', label: 'Green' },
      { key: 'purple', label: 'Purple' }, { key: 'orange', label: 'Orange' }, { key: 'pink', label: 'Pink' },
      { key: 'yellow', label: 'Yellow' }, { key: 'teal', label: 'Teal' }, { key: 'black', label: 'Black' },
      { key: 'white', label: 'White' }] },
    { key: 'hat', label: 'Hat', options: [
      { key: 'none', label: 'None' }, { key: 'cap', label: 'Cap' }, { key: 'beanie', label: 'Beanie' },
      { key: 'cowboy', label: 'Cowboy' }, { key: 'crown', label: 'Crown' }, { key: 'party', label: 'Party' },
      { key: 'tophat', label: 'Top hat' }, { key: 'wizard', label: 'Wizard' }] },
    { key: 'glasses', label: 'Glasses', options: [
      { key: 'none', label: 'None' }, { key: 'round', label: 'Round' }, { key: 'square', label: 'Square' },
      { key: 'shades', label: 'Shades' }, { key: 'hearts', label: 'Hearts' }, { key: 'stars', label: 'Stars' },
      { key: 'sport', label: 'Sport' }] },
    { key: 'bg', label: 'Backdrop', options: [
      { key: 'plain', label: 'Plain' }, { key: 'sky', label: 'Sky' }, { key: 'sunset', label: 'Sunset' },
      { key: 'beach', label: 'Beach' }, { key: 'forest', label: 'Forest' }, { key: 'rainbow', label: 'Rainbow' },
      { key: 'night', label: 'Night' }, { key: 'space', label: 'Space' }, { key: 'mint', label: 'Mint' },
      { key: 'pink', label: 'Pink' }, { key: 'purple', label: 'Purple' }] },
  ];

  /* The stored config is a short JSON string; anything longer than
   * this is garbage, not an avatar. */
  const AVATAR_MAX_LEN = 400;

  /* Validate + normalize an avatar payload. Accepts a config object
   * or its JSON string. Returns a COMPLETE config (missing keys fall
   * back to the defaults) or null when anything is off: not an object,
   * an unknown key, a value that isn't a string on the whitelist, or
   * an oversized payload. Used by the server before storing, and by
   * the server again when reading a stored value back out (defense in
   * depth — a hand-edited DB row still can't inject markup). */
  function sanitizeAvatar(input) {
    let obj = input;
    if (typeof obj === 'string') {
      if (obj.length > 1000) return null;
      try { obj = JSON.parse(obj); } catch (e) { return null; }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const picked = {};
    for (const k of Object.keys(obj)) {
      if (!AVATAR_KEYS.includes(k)) return null;
      const v = obj[k];
      if (typeof v !== 'string' || !AVATAR_OPTIONS[k].includes(v)) return null;
      picked[k] = v;
    }
    const full = { ...AVATAR_DEFAULTS, ...picked };
    if (JSON.stringify(full).length > AVATAR_MAX_LEN) return null;
    return full;
  }

  return {
    SKIN_TONES, HAIR_COLORS, OUTFIT_COLORS, BACKGROUNDS,
    HAIR_ART, MOUTH_ART, FACIAL_HAIR_ART, OUTFIT_ART, HAT_ART, GLASSES_ART,
    AVATAR_KEYS, AVATAR_OPTIONS, AVATAR_DEFAULTS, AVATAR_CATEGORIES,
    AVATAR_MAX_LEN, sanitizeAvatar,
  };
});
