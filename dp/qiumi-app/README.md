# 球迷嘴替 — App UI Kit (TikTok-style)

Interactive, mobile, dark full-bleed recreation of 球迷嘴替 in a TikTok-style vertical
feed. Self-contained (inlines the component styles + tokens) so it renders without the
compiled bundle. Uses the design system's neutral surfaces with flame orange
(`--brand-flame`) as the single accent for CTAs, follow, and 🔥 topics.

## Screens & flow
- **推荐 feed (首页)** — full-screen vertical **swipe feed**, one persona per screen
  (radial-gradient scene, giant emoji), with a right-side **action rail** (follow +,
  ♥ likes, 💬 comments → opens chat, ↗ share) and a bottom overlay: @name, greeting
  hook, 🔥 topic chip, and a 坐下开聊 CTA. Scroll/snap to the next persona.
- **话题 reels** — 今日话题 as full-screen reels (热度, headline, #tags, persona picker
  → 开聊 seeds a chat).
- **Immersive chat** — full-bleed scene, back / emoji / name / 关注 header, translucent
  glass bubbles (assistant white-glass, user flame), rounded pill composer; canned
  in-character replies.
- Top tabs 关注 · 推荐 · 话题; bottom tab bar 首页 / 话题 / 消息 / 我的. Chat overlays full-screen.

All data is mocked from the real persona roster and daily-topic examples. No login
(removed per product owner).

---

*Source: claude.ai/design project `ebfc85b0-bb48-4eed-92e0-edca6dabbdf3`.
Two layouts, one app:*

- *`FanMouth Mobile.html`* — phone layout: full-bleed swipe feed, bottom tab bar,
  chat as full-screen overlay. (Supersedes the earlier `ui_kits/qiumi-app/index.html`
  revision — TikTok-style solid-icon action rail + redesigned Profile: hero
  banner, overlapping avatar, horizontal favorites scroller, settings menu.)
- *`FanMouth Desktop.html`* — TikTok-web layout: 240px sidebar (logo, nav,
  Recent chats), centered 440×660 card feed with the rail beside the card, chat
  as a right panel with max-640px centered messages, centered inbox/profile
  columns, Edit-profile modal.

*Vendored as the design references for the [features-1.md](../../features-1.md)
roadmap ([feature-1.md](../../feature-1.md) holds the design rationale).*
