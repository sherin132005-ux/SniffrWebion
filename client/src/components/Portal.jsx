import { createPortal } from 'react-dom';

// Renders children into #modal-root (a sibling of #root, declared in index.html)
// instead of wherever the calling component happens to sit in the page tree.
//
// Why this exists: a "position: fixed" element's containing block is the
// viewport ONLY if every ancestor has a computed transform/filter/
// backdrop-filter/perspective/will-change/contain of `none`/`auto`. Sniffr's
// pages are full of entrance/hover animations that legitimately use those
// properties, so any modal rendered inline as a descendant of a page is one
// future animation tweak away from silently losing real-viewport positioning
// (exactly what happened with `.page-enter` and `.message-enter-animate`).
// Portaling to a DOM node outside #root removes the possibility entirely,
// regardless of what any current or future ancestor's CSS does.
export default function Portal({ children }) {
  const root = document.getElementById('modal-root') || document.body;
  return createPortal(children, root);
}
