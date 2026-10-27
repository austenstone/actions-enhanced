# UI conventions

- Enhance GitHub's existing UI instead of replacing its run rows, job navigation,
  graph, logs, or menus.
- Use [Primer](https://primer.style/product/) for extension-added UI. Follow the
  [Breadcrumbs component](https://primer.style/product/components/breadcrumbs/)
  for breadcrumb structure, accessibility, and behavior.
- Prefer existing native elements and Primer CSS classes and theme tokens already
  loaded by GitHub. Keep added styles small and scoped to extension-owned elements.
- Reusing page styles does not mean accessing GitHub's private React runtime or
  importing components from hashed page bundles. If a component must be bundled,
  use a supported Primer package deliberately, without injecting a global reset
  or a second theme over GitHub.
- Verify added controls against real GitHub pages in light and dark themes.
  Keep accessible names, current-page semantics, focus behavior, and native links.
