'use strict';
/* mLT. chat — avatar pictures: THE one shared whitelist for the
 * preset portrait gallery. This single module is loaded by the
 * browser (as the global `AvatarPics`, via a plain <script> tag
 * before app.js) AND required by the server (server/index.js) to
 * validate PATCH /api/me avatar payloads.
 *
 * An avatar is no longer a build-a-character config — the owner
 * retired the cartoon maker ("corny", "cheap") in favour of a
 * gallery of glossy 3D animated-movie style portraits. A saved
 * avatar is simply one of these 24 ids, and the portrait itself is
 * the static file /avatars/<id>.webp. If an id isn't in this list,
 * it doesn't exist: the server only ever stores ids from the list,
 * and the client only ever renders <img> tags for ids on it, so a
 * stored avatar can never smuggle markup into anyone's page.
 *
 * Old rows written by the retired maker hold a JSON config object;
 * they are NOT in this list, so they read back as "no avatar" and
 * the client falls back to the classic initial-letter circle.
 *
 * The set is balanced 12 men (p01–p12) and 12 women (p13–p24)
 * across ages, skin tones, hair and outfits. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AvatarPics = api.AVATAR_PICS;
})(typeof self !== 'undefined' ? self : this, function () {

  const AVATAR_PICS = [
    'p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08',
    'p09', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16',
    'p17', 'p18', 'p19', 'p20', 'p21', 'p22', 'p23', 'p24',
  ];

  /* True only for a string that is exactly one of the 24 ids. */
  function isAvatarPic(v) {
    return typeof v === 'string' && AVATAR_PICS.includes(v);
  }

  /* The stored-avatar reader: a valid id passes through; anything
   * else — null, a retired maker's JSON config, garbage — becomes
   * null, i.e. "no avatar" (the initial-letter circle). */
  function sanitizeAvatarId(raw) {
    return isAvatarPic(raw) ? raw : null;
  }

  return { AVATAR_PICS, isAvatarPic, sanitizeAvatarId };
});
