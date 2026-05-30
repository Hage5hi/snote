## Mục tiêu

1. **Unit test `previewScene`** — đảm bảo hover preview hoạt động & không persist.
2. **A11y screen-reader announce** cho SceneToggle khi hover preview.
3. **Mở rộng scene system** sang NotePage / SplitView / RawView / SharePage, dùng chung 1 localStorage key, chỉ tô chrome (topbar + viền), giữ editor/preview body legibility.

---

## Phần 1 — Unit test `previewScene`

**File mới:** `src/hooks/__tests__/use-scene-theme.test.ts`

Test các invariant của hook `useSceneTheme()`:

- `scene` mặc định = `"none"` khi localStorage trống.
- `setScene("cyber-linh-khi")` → ghi vào localStorage + dispatch `scene-theme-change`.
- `previewScene("ethereal-aurora")` → `scene` đổi, `committedScene` KHÔNG đổi, localStorage KHÔNG bị ghi.
- `previewScene(null)` → revert `scene` về `committedScene`.
- `setScene(x)` trong khi đang preview → clear preview, commit `x`, `scene === committedScene === x`.
- Cross-instance sync: 2 instance của hook trong cùng tab thấy cùng giá trị preview (test qua dispatch event thủ công).
- `storage` event từ tab khác (key=`home.scene`) cập nhật `committedScene`.

Test mới sẽ thêm 1 assertion vào `SceneToggle.i18n.test.tsx` xác nhận hover (`fireEvent.mouseEnter` trên 1 menuitemradio) đổi DOM cue (xem Phần 2) mà KHÔNG ghi `home.scene`.

---

## Phần 2 — A11y: announce label khi hover preview

**Vấn đề hiện tại:** `previewScene(id)` chỉ đổi background, screen reader không biết. User mù không nhận được feedback rằng hover đang đổi scene.

**Giải pháp:**

a. Thêm `aria-live="polite"` region (visually hidden) trong `SceneToggle.tsx`. Khi `hoverPreview` đổi, region thông báo dạng `t("scene.previewing", { name })` (vd: "Previewing Cyber Linh Khí"). Khi commit hoặc revert → clear text.

b. Thêm `aria-describedby` nối `DropdownMenuRadioItem` với một mô tả ngắn (`scene.preview.hint` = "Hover to preview, click to apply") để new user hiểu pattern.

c. i18n keys mới trong `src/i18n/index.ts` cho cả 6 locale:
   - `scene.preview.announcing` — "Previewing {name}"
   - `scene.preview.committed` — "Applied {name}"
   - `scene.preview.reverted` — "Preview cancelled"

d. Tôn trọng `prefers-reduced-motion`: đã có guard không preview, nhưng vẫn announce label khi hover (preview state vẫn track, chỉ skip visual transition). Cân nhắc: KHÔNG preview → KHÔNG announce. Giữ nguyên hành vi: reduced-motion = không preview = không announce (an toàn).

e. Test mới: `SceneToggle.a11y.test.tsx` xác nhận live region tồn tại, render đúng text khi hover, clear khi `mouseLeave`/`close`.

---

## Phần 3 — Scene system cho note surfaces

### Quyết định kiến trúc (đã chốt với bạn)

- **Cả 6 scene** đều áp dụng (kể cả Terminal Boot, Neon Vapor).
- **Chỉ tô chrome** (topbar + viền + watermark mép). Editor/Preview body giữ `bg-background` đặc → legibility tuyệt đối.
- **Persistence dùng chung** localStorage key `home.scene` (rename concept thành "app scene" trong comments, không đổi key để không phá data hiện có).
- **Tất cả surface** /:slug family: NotePage, SplitView, RawView, SharePage.
- **Không áp scene** cho /note (AdminPanel) — admin surface phải neutral.

### Thay đổi cụ thể

**a. Đổi tên scope của isolation script**
`scripts/check-home-theme-isolation.ts` → đổi target list. Cho phép `data-scene` + `data-app-root` + SceneHost xuất hiện trong NotePage/Editor/Preview surfaces, nhưng vẫn cấm chúng leak vào `AdminPanel.tsx`. Vẫn cấm hard-coded scene IDs (vd `"cyber-linh-khi"`) trong các surface không phải dispatcher/registry.

**b. Component mới `<AppShell>` (hoặc rename `SceneHost` → reusable)**

Tạo `src/components/app/AppShell.tsx` wrap children với:
- `data-app-root="true"` + `data-scene={hasScene ? scene : undefined}`
- Mount `<SceneHost />` nếu `hasScene`
- Background = `bg-transparent` khi hasScene, ngược lại `bg-background`

Home.tsx, NotePage.tsx, SplitView.tsx, RawView.tsx, SharePage.tsx đều bọc bằng `<AppShell>`.

**c. CSS token rename: `--home-*` → `--app-*`**

Trong `src/index.css`:
- Đổi selector `[data-home-root]` → `[data-app-root]`
- Rename biến `--home-chrome-bg/border/mask-top/...` → `--app-chrome-bg/...`
- Giữ alias `--home-*` trong 1 release để backward-compat (Home.tsx vẫn đọc `var(--home-chrome-bg)` được).
- Hoặc đơn giản hơn: đổi Home.tsx và các consumer cùng lúc, không cần alias.

Chọn **không cần alias** vì đây là internal API, đổi 1 file `Home.tsx` + index.css là xong.

**d. Topbar (note) ăn scene tokens**

Trong `src/components/note/topbar/Topbar.tsx` (275 lines): khi `hasScene`, đổi:
- `background` của bar → `var(--app-chrome-bg)`
- `borderColor` → `var(--app-chrome-border)`
- Thêm `motion-safe:backdrop-blur-md`

Editor body wrapper, Preview body wrapper: **KHÔNG đổi** — giữ `bg-background`. Chỉ outer container của route trong suốt để SceneHost lộ ra ở viền (mask top/bottom đã có sẵn).

**e. SceneToggle trên note surface**

Thêm `<SceneToggle />` vào Topbar (cạnh existing ThemeToggle/LanguageToggle nếu có). Cho phép user đổi scene từ trong note luôn — không cần về Home.

**f. SharePage / RawView**

Surfaces này có topbar/chrome riêng đơn giản hơn. Wrap bằng AppShell, áp cùng tokens vào header của chúng. Không thêm SceneToggle (read-only surfaces, scene đã chọn từ Home/Note).

**g. Cập nhật `shouldBlockScene`**

SceneHost guard hiện chỉ check `eink`, `reduced-motion`, `low-end CPU`, `WebGL`, `saveData`. Áp cho note vẫn đúng — không đổi logic. Note có thêm yêu cầu: pause scene khi user đang typing dài? **Bỏ qua** — chrome opacity 0.4-0.6 + content body đặc đủ để không phân tâm.

### Files thay đổi (Phần 3)

```
NEW   src/components/app/AppShell.tsx
EDIT  src/index.css                              (rename --home-* → --app-*, selector)
EDIT  src/pages/Home.tsx                         (bọc AppShell, dùng var(--app-*))
EDIT  src/pages/NotePage.tsx                     (bọc AppShell)
EDIT  src/pages/SplitView.tsx                    (bọc AppShell)
EDIT  src/pages/RawView.tsx                      (bọc AppShell)
EDIT  src/pages/SharePage.tsx                    (bọc AppShell)
EDIT  src/components/note/topbar/Topbar.tsx      (ăn app-chrome tokens, thêm SceneToggle)
EDIT  scripts/check-home-theme-isolation.ts      (chuyển từ chặn → chặn-trừ-AppShell, vẫn chặn cho AdminPanel)
EDIT  e2e/helpers + e2e/home-scene.spec.ts       (nếu test dựa trên data-home-root → đổi data-app-root)
```

---

## Risk & Test plan

- **Risk 1: Editor performance** khi scene background animate phía sau. Mitigation: editor body có `bg-background` đặc → scene KHÔNG ảnh hưởng paint của editor pane (browser composite layer riêng).
- **Risk 2: Vim mode hoặc Typewriter mode** vẽ overlay → có thể conflict z-index. Mitigation: SceneHost z-index = 0, content z-index = 10, đã đúng.
- **Risk 3: Legacy test `check-home-theme-isolation`** sẽ fail. Mitigation: cập nhật script trong cùng PR.
- **Risk 4: Visual regression** trên 6 scene × 4 surface = 24 snapshots mới. Mitigation: chỉ thêm snapshot cho NotePage (1 surface) × 6 scene = 6, giữ tightness.

**Verify:**
- `bun run check:home-isolation` pass (renamed/updated).
- Vitest: tất cả test mới + cũ pass.
- Manual: mở /:slug với từng scene → editor vẫn legible, topbar lộ scene; SceneToggle trong topbar đổi scene tức thì; hover preview vẫn chạy.
- Axe: SceneToggle dropdown không sinh violation mới (re-run `e2e/a11y-interactions.spec.ts` style check).

---

## Thứ tự thực thi đề xuất

1. Phần 1 (test `previewScene`) — nhỏ, isolated, dễ verify trước.
2. Phần 2 (a11y announce) — chỉ động SceneToggle + i18n.
3. Phần 3 (mở rộng scene) — lớn nhất, đổi nhiều file; làm cuối cùng, có test ở Phần 1 để bảo vệ regression.
