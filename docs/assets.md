# Static assets

The web app serves every font and image itself. Nothing is loaded from a foreign host at runtime, so the app works on Iran's national internet when international access is cut. Keep it that way: add new assets to the repository, never as links to external hosts.

## Fonts (`app/fonts`)

| File | Font | Subset | Licence |
|------|------|--------|---------|
| `dm-sans-latin.woff2`, `dm-sans-latin-ext.woff2` | DM Sans (variable, weights 400–700) | latin, latin-ext | SIL Open Font License 1.1 (`OFL-DMSans.txt`) |
| `manrope-latin.woff2`, `manrope-latin-ext.woff2` | Manrope (variable, weights 400–800) | latin, latin-ext | SIL Open Font License 1.1 (`OFL-Manrope.txt`) |

- The files are the ones Google Fonts serves (DM Sans v17, Manrope v20).
- `app/globals.css` declares them with `@font-face` and the same `unicode-range` values Google Fonts uses. A page downloads only the subsets its text needs.
- Persian text uses the system font (`Segoe UI`, then `sans-serif`), the same as before these files were added. Adding a Persian web font, for example Vazirmatn (OFL), is a separate design decision.

## Images (`public/images`)

The images are starter photos for the demo home. They are WebP files made from the original photos: resized to 1920 or 960 px wide, quality about 78.

| File | Used for | Source (Unsplash CDN id) | Licence |
|------|----------|--------|---------|
| `living-1920.webp`, `living-960.webp` | dashboard hero, sign-in screen, "Tehran Villa" cover, living room | `images.unsplash.com/photo-1600210492486-724fe5c67fb0` | [Unsplash License](https://unsplash.com/license) |
| `exterior-1920.webp`, `exterior-960.webp` | "Caspian House" cover, garden terrace, entry camera | `images.unsplash.com/photo-1600607687939-ce8a6c25118c` | Unsplash License |
| `kitchen-960.webp` | kitchen, garden camera | `images.unsplash.com/photo-1600585154340-be6161a56a0c` | Unsplash License |
| `bedroom-960.webp` | primary suite, default image for a new room | `images.unsplash.com/photo-1616486338812-3dadae4b4ace` | Unsplash License |

The Unsplash License allows free commercial and non-commercial use without attribution. It does not allow selling the photos unaltered or using them to build a competing photo service.

**Saved workspaces.** A workspace saved in the browser before this change still holds `images.unsplash.com` URLs. `services/workspace-store.ts` maps them to the local copies when the workspace is loaded.

**Adding an image.**
1. Convert it to WebP with a sensible width (960 px for cards, 1920 px for full-width images).
2. Put it in `public/images`.
3. Add a row to the table above with its source and licence.
