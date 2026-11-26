/**
 * Locates elements by ARIA role and accessible name, computed from tags and
 * attributes, so a test finds elements the way assistive technology does.
 *
 * The same lookups run over a scene's view value, a `TestHost` tree and a
 * real DOM tree. `role`, `label` and `placeholder` return a `Locator`, so
 * they combine with `Locator.inside` on the first two. On the DOM, `click`,
 * `type`, `keydown` and `submit` act as the user would, through real DOM
 * events.
 *
 * Hidden elements (`hidden`, `aria-hidden="true"`, `<input type="hidden">`)
 * and everything inside them are left out unless `hidden: true` is passed.
 *
 * On a structural tree a match is typed `Locator.Node`, since it can be any
 * node of the tree. On `TestHost`, `root.all(DomLocator.role(...))` keeps the
 * host's node type. On the DOM a match is an `HTMLElement`.
 *
 * **Example** (Finding a button by its name)
 *
 * ```ts
 * import { DomLocator } from "@ilha/model/test"
 *
 * const tree = {
 *   tag: "form",
 *   children: [
 *     { tag: "label", attrs: { for: "new" }, children: [{ text: "New todo" }] },
 *     { tag: "input", attrs: { id: "new" } },
 *     { tag: "button", attrs: { type: "submit" }, children: [{ text: "Add" }] }
 *   ]
 * }
 *
 * console.log(DomLocator.getByRole(tree, "button", { name: "Add" }) === tree.children[2]) // true
 * console.log(DomLocator.nameOf(tree, DomLocator.getByRole(tree, "textbox"))) // "New todo"
 * ```
 */
import * as Locator from "./locator.ts";

// ---------------------------------------------------------------------------
// trees
// ---------------------------------------------------------------------------

/** One way to read a tree: the structural `Locator.Node` shape or the DOM. */
interface Reader<N> {
  readonly isElement: (node: N) => boolean;
  readonly tag: (node: N) => string;
  readonly attr: (node: N, name: string) => string | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- prop values are arbitrary DOM expandos or scene props; callers narrow them per field.
  readonly prop: (node: N, name: string) => unknown;
  readonly children: (node: N) => readonly N[];
  /** The text of a text node, or `undefined` for anything else. */
  readonly text: (node: N) => string | undefined;
}

/** Whether `node` is a DOM node: a non-null object carrying a numeric `nodeType`. */
const isDom = <T>(node: T): node is T & globalThis.Node =>
  typeof node === "object" &&
  node !== null &&
  // SAFETY: the checks above leave only non-null objects; reading `nodeType` validates the DOM shape.
  typeof (node as { nodeType?: unknown }).nodeType === "number";

/** Whether `value` is a string. */
const isString = <T>(value: T): value is T & string =>
  typeof value === "string";

const domReader: Reader<globalThis.Node> = {
  // SAFETY: `nodeType === 1` marks an element; elements expose `getAttribute`.
  attr: (node, name) =>
    node.nodeType === 1
      ? ((node as globalThis.Element).getAttribute(name) ?? undefined)
      : undefined,
  children: (node) => [...node.childNodes],
  isElement: (node) => node.nodeType === 1,
  // SAFETY: DOM nodes carry arbitrary expando props (value, checked); read as an open record.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- Node lacks an index signature, so tsc requires erasing to unknown before the open expando read.
  prop: (node, name) => (node as unknown as Record<string, unknown>)[name],
  // SAFETY: tags are read only for elements; elements expose `localName`.
  tag: (node) => (node as globalThis.Element).localName,
  text: (node) =>
    // SAFETY: `nodeType === 3` marks a text node; text nodes expose `data`.
    node.nodeType === 3 ? (node as globalThis.Text).data : undefined,
};

const structuralReader: Reader<Locator.Node> = {
  attr: (node, name) => node.attrs?.[name],
  children: (node) => node.children ?? [],
  isElement: (node) => node.tag !== undefined,
  prop: (node, name) => node.props?.[name],
  tag: (node) => node.tag!, // oxlint-disable-line typescript/no-non-null-assertion -- tag runs only on elements; isElement confirmed `tag` is set.
  text: (node) => (node.tag === undefined ? node.text : undefined),
};

// SAFETY: overloads below pin the node type per call; the impl erases it and re-reads per node.
// oxlint-disable-next-line typescript/no-explicit-any, anti-slop/no-unknown-parameters -- the erased impl serves both DOM and structural readers; the unknown node is narrowed with isDom below.
const readerOf = (node: unknown): Reader<any> =>
  isDom(node) ? domReader : structuralReader;

// ---------------------------------------------------------------------------
// roles
// ---------------------------------------------------------------------------

/** Elements under which `header` and `footer` lose their landmark role. */
const sectioning: ReadonlySet<string> = new Set([
  "article",
  "aside",
  "main",
  "nav",
  "section",
]);

// oxlint-disable-next-line anti-slop/no-known-value-widening -- role lookup by tag needs an open index; every value below is a concrete role string.
const fixedRoles: Readonly<Record<string, string>> = {
  article: "article",
  aside: "complementary",
  blockquote: "blockquote",
  button: "button",
  caption: "caption",
  code: "code",
  datalist: "listbox",
  dd: "definition",
  del: "deletion",
  details: "group",
  dfn: "term",
  dialog: "dialog",
  dt: "term",
  em: "emphasis",
  fieldset: "group",
  figure: "figure",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  hr: "separator",
  ins: "insertion",
  li: "listitem",
  main: "main",
  menu: "list",
  meter: "meter",
  nav: "navigation",
  ol: "list",
  optgroup: "group",
  option: "option",
  output: "status",
  p: "paragraph",
  progress: "progressbar",
  search: "search",
  strong: "strong",
  sub: "subscript",
  sup: "superscript",
  table: "table",
  tbody: "rowgroup",
  td: "cell",
  textarea: "textbox",
  tfoot: "rowgroup",
  thead: "rowgroup",
  time: "time",
  tr: "row",
  ul: "list",
};

const inputRole = (type: string, hasList: boolean): string | undefined => {
  switch (type) {
    case "button":
    case "image":
    case "reset":
    case "submit": {
      return "button";
    }
    case "checkbox": {
      return "checkbox";
    }
    case "radio": {
      return "radio";
    }
    case "range": {
      return "slider";
    }
    case "number": {
      return "spinbutton";
    }
    case "search": {
      return hasList ? "combobox" : "searchbox";
    }
    case "":
    case "email":
    case "tel":
    case "text":
    case "url": {
      return hasList ? "combobox" : "textbox";
    }
    default: {
      return undefined;
    }
  }
};

/** Roles whose accessible name comes from their content when nothing else names them. */
const nameFromContent: ReadonlySet<string> = new Set([
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "gridcell",
  "heading",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "row",
  "rowheader",
  "switch",
  "tab",
  "tooltip",
  "treeitem",
]);

// ---------------------------------------------------------------------------
// the index of a tree
// ---------------------------------------------------------------------------

interface Entry<N> {
  readonly node: N;
  readonly role: string | undefined;
  readonly hidden: boolean;
  /** The `label` elements this element sits inside, innermost first. */
  readonly labels: readonly N[];
  readonly inSection: boolean;
}

interface Index<N> {
  readonly reader: Reader<N>;
  readonly entries: readonly Entry<N>[];
  readonly byNode: Map<N, Entry<N>>;
  readonly byId: Map<string, N>;
  readonly labelsFor: Map<string, N[]>;
}

/** Whether a `dialog` is open: its `open` property, or its `open` attribute when no property was set. */
const dialogOpen = <N>(reader: Reader<N>, node: N): boolean => {
  const open = reader.prop(node, "open");
  return open === undefined
    ? reader.attr(node, "open") !== undefined
    : open === true || open === "modal";
};

/**
 * Whether a popover is showing: its `popoverOpen` property, set by `.popover`, or `:popover-open` on a DOM
 * element. A DOM without `:popover-open` reports it closed.
 */
const popoverOpen = <N>(reader: Reader<N>, node: N): boolean => {
  const open = reader.prop(node, "popoverOpen");
  if (open !== undefined || !isDom(node)) {
    return open === true;
  }
  try {
    // SAFETY: the guard above leaves only DOM nodes; every element supports `matches`.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- node is N & Node after the guard, which tsc will not convert directly; erasing before the Element downcast.
    return (node as unknown as globalThis.Element).matches(":popover-open");
  } catch {
    return false;
  }
};

/** Whether a dialog or popover is neither open as a dialog nor showing as a popover. */
const notShown = <N>(reader: Reader<N>, node: N): boolean => {
  const dialog = reader.tag(node) === "dialog";
  const popover = reader.attr(node, "popover") !== undefined;
  if (!dialog && !popover) {
    return false;
  }
  return !(
    (dialog && dialogOpen(reader, node)) ||
    (popover && popoverOpen(reader, node))
  );
};

const isHidden = <N>(reader: Reader<N>, node: N): boolean =>
  reader.attr(node, "hidden") !== undefined ||
  reader.attr(node, "aria-hidden") === "true" ||
  (reader.tag(node) === "input" &&
    (reader.attr(node, "type") ?? "").toLowerCase() === "hidden") ||
  reader.tag(node) === "template" ||
  // A closed dialog or a popover that isn't showing isn't rendered, so neither it nor anything in it is
  // in the accessibility tree. A dialog shown as a popover is rendered, though its `open` is false.
  notShown(reader, node);

// oxlint-disable-next-line eslint/complexity -- the implicit-role table maps every tag in one switch; splitting it would scatter the ARIA lookup.
const implicitRole = <N>(
  reader: Reader<N>,
  node: N,
  inSection: boolean
): string | undefined => {
  const tag = reader.tag(node);
  switch (tag) {
    case "a":
    case "area": {
      return reader.attr(node, "href") === undefined ? undefined : "link";
    }
    case "header": {
      return inSection ? undefined : "banner";
    }
    case "footer": {
      return inSection ? undefined : "contentinfo";
    }
    case "img": {
      return reader.attr(node, "alt") === "" ? "presentation" : "img";
    }
    case "input": {
      return inputRole(
        (reader.attr(node, "type") ?? "").toLowerCase(),
        reader.attr(node, "list") !== undefined
      );
    }
    case "select": {
      const size = Number(reader.attr(node, "size") ?? "1");
      return reader.attr(node, "multiple") !== undefined || size > 1
        ? "listbox"
        : "combobox";
    }
    case "section": {
      return reader.attr(node, "aria-label") !== undefined ||
        reader.attr(node, "aria-labelledby") !== undefined ||
        reader.attr(node, "title") !== undefined
        ? "region"
        : undefined;
    }
    case "th": {
      return reader.attr(node, "scope") === "row"
        ? "rowheader"
        : "columnheader";
    }
    default: {
      return fixedRoles[tag];
    }
  }
};

const buildIndex = <N>(root: N): Index<N> => {
  // SAFETY: root decides the tree kind; this reader matches root and every node walked from it.
  const reader = readerOf(root) as Reader<N>;
  const index: Index<N> = {
    byId: new Map(),
    byNode: new Map(),
    entries: [],
    labelsFor: new Map(),
    reader,
  };
  // SAFETY: entries starts empty and only receives Entry<N> pushes during the walk below.
  const entries = index.entries as Entry<N>[];
  const walk = (
    node: N,
    hidden: boolean,
    labels: readonly N[],
    inSection: boolean
  ) => {
    if (!reader.isElement(node)) {
      // A document, a fragment or a structural wrapper isn't indexed, but what it holds is.
      if (reader.text(node) === undefined) {
        for (const child of reader.children(node)) {
          walk(child, hidden, labels, inSection);
        }
      }
      return;
    }
    const tag = reader.tag(node);
    const isHiddenHere = hidden || isHidden(reader, node);
    const explicit = reader.attr(node, "role")?.trim().split(/\s+/u)[0];
    const entry: Entry<N> = {
      hidden: isHiddenHere,
      inSection,
      labels,
      node,
      role:
        explicit !== undefined && explicit !== ""
          ? explicit
          : implicitRole(reader, node, inSection),
    };
    entries.push(entry);
    index.byNode.set(node, entry);
    const id = reader.attr(node, "id");
    if (id !== undefined && !index.byId.has(id)) {
      index.byId.set(id, node);
    }
    if (tag === "label") {
      const target = reader.attr(node, "for");
      if (target !== undefined) {
        const list = index.labelsFor.get(target) ?? [];
        list.push(node);
        index.labelsFor.set(target, list);
      }
    }
    const childLabels = tag === "label" ? [node, ...labels] : labels;
    const childSection = inSection || sectioning.has(tag);
    for (const child of reader.children(node)) {
      walk(child, isHiddenHere, childLabels, childSection);
    }
  };
  walk(root, false, [], false);
  return index;
};

// ---------------------------------------------------------------------------
// accessible names
// ---------------------------------------------------------------------------

const normalize = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim();

const phrasing: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);

/** The text an element contributes as content: its text, with hidden parts and controls left out. */
const contentText = <N>(
  index: Index<N>,
  node: N,
  skip: N | undefined,
  includeHidden: boolean
): string => {
  const { reader } = index;
  const text = reader.text(node);
  if (text !== undefined) {
    return text;
  }
  if (!reader.isElement(node) || node === skip) {
    return "";
  }
  if (!includeHidden && isHidden(reader, node)) {
    return "";
  }
  const tag = reader.tag(node);
  if (tag === "br") {
    return " ";
  }
  if (tag === "img") {
    return reader.attr(node, "alt") ?? "";
  }
  if (tag === "input" || tag === "select" || tag === "textarea") {
    return "";
  }
  const label = reader.attr(node, "aria-label");
  const inner =
    label !== undefined && label.trim() !== ""
      ? label
      : reader
          .children(node)
          .map((child) => contentText(index, child, skip, includeHidden))
          .join("");
  return phrasing.has(tag) ? inner : ` ${inner} `;
};

const textOfIds = <N>(index: Index<N>, ids: string): string =>
  normalize(
    ids
      .trim()
      .split(/\s+/u)
      .map((id) => {
        const node = index.byId.get(id);
        return node === undefined
          ? ""
          : contentText(index, node, undefined, true);
      })
      .join(" ")
  );

const firstChildText = <N>(
  index: Index<N>,
  node: N,
  tag: string
): string | undefined => {
  const child = index.reader
    .children(node)
    .find((c) => index.reader.isElement(c) && index.reader.tag(c) === tag);
  return child === undefined
    ? undefined
    : normalize(contentText(index, child, undefined, false));
};

// oxlint-disable-next-line eslint/complexity -- the accessible-name computation follows the ARIA precedence ladder in one pass; splitting it would scatter the fallback order.
const computeName = <N>(index: Index<N>, entry: Entry<N>): string => {
  const { reader } = index;
  const { node } = entry;
  const labelledBy = reader.attr(node, "aria-labelledby");
  if (labelledBy !== undefined && labelledBy.trim() !== "") {
    const name = textOfIds(index, labelledBy);
    if (name !== "") {
      return name;
    }
  }
  const label = reader.attr(node, "aria-label");
  if (label !== undefined && label.trim() !== "") {
    return normalize(label);
  }
  const tag = reader.tag(node);
  const type = (reader.attr(node, "type") ?? "").toLowerCase();
  if (
    tag === "input" &&
    (type === "button" || type === "submit" || type === "reset")
  ) {
    // SAFETY: button values are strings when present; anything else falls through to the type default below.
    const value =
      reader.attr(node, "value") ??
      (reader.prop(node, "value") as string | undefined);
    if (value !== undefined && value !== "") {
      return normalize(value);
    }
    if (type === "submit") {
      return "Submit";
    }
    if (type === "reset") {
      return "Reset";
    }
    return "";
  }
  if (tag === "input" && type === "image") {
    return normalize(reader.attr(node, "alt") ?? "");
  }
  if (
    tag === "input" ||
    tag === "select" ||
    tag === "textarea" ||
    tag === "meter" ||
    tag === "progress"
  ) {
    const id = reader.attr(node, "id");
    // A label can both name the control by `for` and wrap it: it counts once.
    const labels = [
      ...new Set([
        ...(id === undefined ? [] : (index.labelsFor.get(id) ?? [])),
        ...entry.labels,
      ]),
    ];
    const fromLabels = normalize(
      labels.map((l) => contentText(index, l, node, false)).join(" ")
    );
    if (fromLabels !== "") {
      return fromLabels;
    }
  }
  if (tag === "img" || tag === "area") {
    const alt = reader.attr(node, "alt");
    if (alt !== undefined && alt.trim() !== "") {
      return normalize(alt);
    }
  }
  if (tag === "fieldset") {
    const legend = firstChildText(index, node, "legend");
    if (legend !== undefined && legend !== "") {
      return legend;
    }
  }
  if (tag === "table") {
    const caption = firstChildText(index, node, "caption");
    if (caption !== undefined && caption !== "") {
      return caption;
    }
  }
  if (tag === "figure") {
    const caption = firstChildText(index, node, "figcaption");
    if (caption !== undefined && caption !== "") {
      return caption;
    }
  }
  if (entry.role !== undefined && nameFromContent.has(entry.role)) {
    const content = normalize(contentText(index, node, undefined, false));
    if (content !== "") {
      return content;
    }
  }
  const title = reader.attr(node, "title");
  if (title !== undefined && title.trim() !== "") {
    return normalize(title);
  }
  if (tag === "input" || tag === "textarea") {
    const placeholder = reader.attr(node, "placeholder");
    if (placeholder !== undefined) {
      return normalize(placeholder);
    }
  }
  return "";
};

const isChecked = <N>(reader: Reader<N>, node: N): boolean | undefined => {
  const aria = reader.attr(node, "aria-checked");
  if (aria !== undefined) {
    return aria === "true";
  }
  if (reader.tag(node) !== "input") {
    return undefined;
  }
  const prop = reader.prop(node, "checked");
  if (prop === true) {
    return true;
  }
  if (prop === false) {
    return false;
  }
  return reader.attr(node, "checked") !== undefined;
};

const levelOf = <N>(reader: Reader<N>, node: N): number | undefined => {
  const aria = reader.attr(node, "aria-level");
  if (aria !== undefined) {
    return Number(aria);
  }
  const match = /^h(?<level>[1-6])$/u.exec(reader.tag(node));
  const level = match?.groups?.level;
  return level === undefined ? undefined : Number(level);
};

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

/**
 * What a role query matches besides the role.
 *
 * **Details**
 *
 * `name` matches the accessible name exactly (after collapsing whitespace),
 * or tests it with a RegExp. `checked` matches a checkbox or radio button's
 * live state, and `level` a heading's. `hidden: true` includes hidden
 * elements.
 */
export interface RoleOptions {
  readonly name?: string | RegExp | undefined;
  readonly checked?: boolean | undefined;
  readonly level?: number | undefined;
  readonly hidden?: boolean | undefined;
}

const describeOptions = (
  role: string,
  options: RoleOptions | undefined
): string => {
  const parts = [`role ${JSON.stringify(role)}`];
  if (options?.name !== undefined) {
    parts.push(
      `name ${
        isString(options.name)
          ? JSON.stringify(options.name)
          : String(options.name)
      }`
    );
  }
  if (options?.checked !== undefined) {
    parts.push(`checked ${options.checked}`);
  }
  if (options?.level !== undefined) {
    parts.push(`level ${options.level}`);
  }
  return parts.join(", ");
};

const select = <N>(
  index: Index<N>,
  role: string,
  options: RoleOptions | undefined
): N[] => {
  const out: N[] = [];
  for (const entry of index.entries) {
    if (entry.role !== role) {
      continue;
    }
    if (entry.hidden && options?.hidden !== true) {
      continue;
    }
    if (
      options?.checked !== undefined &&
      isChecked(index.reader, entry.node) !== options.checked
    ) {
      continue;
    }
    if (
      options?.level !== undefined &&
      levelOf(index.reader, entry.node) !== options.level
    ) {
      continue;
    }
    if (options?.name !== undefined) {
      const name = computeName(index, entry);
      if (
        isString(options.name)
          ? name !== normalize(options.name)
          : !options.name.test(name)
      ) {
        continue;
      }
    }
    out.push(entry.node);
  }
  return out;
};

/** The overloads of {@link queryAllByRole}: one per tree kind. */
interface QueryAllByRole {
  (
    root: globalThis.Node,
    role: string,
    options?: RoleOptions
  ): readonly HTMLElement[];
  (
    root: Locator.Node,
    role: string,
    options?: RoleOptions
  ): readonly Locator.Node[];
}

/**
 * Every element under `root`, `root` included, with role `role` and matching
 * `options`, in document order.
 */
export const queryAllByRole: QueryAllByRole = (
  // SAFETY: overloads pin node types; impl erases across DOM and structural trees.
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
  root: any,
  role: string,
  options?: RoleOptions
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
): readonly any[] => select(buildIndex(root), role, options);

const describeIndex = <N>(index: Index<N>): string => {
  const lines = index.entries
    .filter((entry) => entry.role !== undefined && !entry.hidden)
    .map(
      (entry) => `  ${entry.role} ${JSON.stringify(computeName(index, entry))}`
    );
  return lines.length === 0 ? "  (none)" : lines.join("\n");
};

/** The overloads of {@link getByRole}: one per tree kind. */
interface GetByRole {
  (root: globalThis.Node, role: string, options?: RoleOptions): HTMLElement;
  (root: Locator.Node, role: string, options?: RoleOptions): Locator.Node;
}

/**
 * The one element under `root` with role `role` and matching `options`.
 * Throws when there's none or several, listing the roles and names there are.
 */
export const getByRole: GetByRole = (
  // SAFETY: overloads pin node types; impl erases across DOM and structural trees.
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
  root: any,
  role: string,
  options?: RoleOptions
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
): any => {
  const index = buildIndex(root);
  const found = select(index, role, options);
  if (found.length === 1) {
    return found[0];
  }
  if (found.length > 1) {
    throw new Error(
      `DomLocator: ${found.length} elements have ${describeOptions(
        role,
        options
      )}`
    );
  }
  throw new Error(
    `DomLocator: nothing has ${describeOptions(role, options)}. Roles here:\n${describeIndex(
      index
    )}`
  );
};

/** The overloads of {@link roleOf}: one per tree kind. */
interface RoleOf {
  (root: globalThis.Node, node: globalThis.Node): string | undefined;
  (root: Locator.Node, node: Locator.Node): string | undefined;
}

/**
 * The role of `node`: its `role` attribute, else the implicit role of its tag
 * and attributes, else `undefined`. `root` is the tree it's in, which decides
 * the role of `header` and `footer`.
 */
export const roleOf: RoleOf = (
  // SAFETY: overloads pin node types; impl erases across DOM and structural trees.
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
  root: any,
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
  node: any
): string | undefined => buildIndex(root).byNode.get(node)?.role;

/** The overloads of {@link nameOf}: one per tree kind. */
interface NameOf {
  (root: globalThis.Node, node: globalThis.Node): string;
  (root: Locator.Node, node: Locator.Node): string;
}

/**
 * The accessible name of `node`, computed within `root`: from
 * `aria-labelledby`, `aria-label`, its labels, `alt`, a `legend` or `caption`,
 * its content for roles named by their content, then `title` and
 * `placeholder`.
 */
export const nameOf: NameOf = (
  // SAFETY: overloads pin node types; impl erases across DOM and structural trees.
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
  root: any,
  // oxlint-disable-next-line typescript/no-explicit-any -- erased overload impl; the overloads above pin node types per call.
  node: any
): string => {
  const index = buildIndex(root);
  const entry = index.byNode.get(node);
  return entry === undefined ? "" : computeName(index, entry);
};

/**
 * A `Locator` for elements with role `role` and matching `options`, to
 * combine with `Locator.inside` and the other locators.
 */
export const role = (
  roleName: string,
  options?: RoleOptions
): Locator.Locator => ({
  all: (root) => select(buildIndex(root), roleName, options),
  description: describeOptions(roleName, options),
});

// ---------------------------------------------------------------------------
// acting on the DOM
// ---------------------------------------------------------------------------

/**
 * The form fields labelled `text`: by a `<label>` around them or naming
 * their `id` in `for`, by `aria-labelledby`, or by `aria-label`. The label's
 * text is trimmed and must equal `text`, or contain it with
 * `{ exact: false }`.
 *
 * **Example** (A field by its label)
 *
 * ```ts
 * import { DomLocator } from "@ilha/model/test"
 * import { Locator } from "@ilha/model/test"
 *
 * const tree = {
 *   tag: "form",
 *   children: [
 *     { tag: "label", attrs: { for: "zip" }, children: [{ text: "Zip code" }] },
 *     { tag: "input", attrs: { id: "zip" } }
 *   ]
 * }
 *
 * console.log(Locator.get(tree, DomLocator.label("Zip code")) === tree.children[1]) // true
 * ```
 */
/** Tags that a `<label>` can name: inputs, buttons and their meter/output cousins. */
const labelable: ReadonlySet<string> = new Set([
  "input",
  "select",
  "textarea",
  "button",
  "meter",
  "output",
  "progress",
]);

export const label = (
  text: string,
  options?: { readonly exact?: boolean | undefined }
): Locator.Locator => {
  const matches = (candidate: string) =>
    options?.exact === false
      ? candidate.includes(text)
      : candidate.trim() === text;
  return {
    all: <N extends Locator.Node>(root: N): readonly N[] => {
      const every = Locator.elements(root);
      const byId = new Map(
        every.flatMap((node) =>
          node.attrs?.id === undefined ? [] : [[node.attrs.id, node] as const]
        )
      );
      const found = new Set<Locator.Node>();
      for (const node of every) {
        if (node.tag === "label" && matches(Locator.textOf(node))) {
          const target = node.attrs?.for;
          const field =
            target === undefined
              ? Locator.elements(node).find(
                  (inner) =>
                    inner !== node &&
                    inner.tag !== undefined &&
                    labelable.has(inner.tag)
                )
              : byId.get(target);
          if (field !== undefined) {
            found.add(field);
          }
        }
        const aria = node.attrs?.["aria-label"];
        if (aria !== undefined && matches(aria)) {
          found.add(node);
        }
        const by = node.attrs?.["aria-labelledby"];
        if (by !== undefined) {
          const named = by
            .split(/\s+/u)
            .flatMap((id) => {
              const other = byId.get(id);
              return other === undefined ? [] : [Locator.textOf(other)];
            })
            .join(" ");
          if (matches(named)) {
            found.add(node);
          }
        }
      }
      return every.filter((node) => found.has(node));
    },
    description: `label ${JSON.stringify(text)}`,
  };
};

/**
 * The elements whose `placeholder` is `text`.
 */
export const placeholder = (text: string): Locator.Locator =>
  Locator.attr("placeholder", text);

/**
 * Whether a dialog is closed, open, or open as a modal. It reads a scene's
 * view or a `TestHost` tree, where `.modal(true)` sets `open` to `"modal"`,
 * or a DOM dialog, which is a modal when it matches `:modal`. A DOM without
 * `:modal`, such as some test environments, reports a modal as `"open"`.
 *
 * **Example** (Checking a confirm dialog)
 *
 * ```ts
 * import { DomLocator } from "@ilha/model/test"
 *
 * declare const scene: { get: (locator: unknown) => unknown }
 * const dialog = scene.get(DomLocator.role("dialog", { name: "Delete note?" }))
 * console.log(DomLocator.dialogState(dialog)) // "modal"
 * ```
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- dialog state reads DOM or structural trees; narrowed with isDom below.
export const dialogState = (node: unknown): "closed" | "open" | "modal" => {
  if (isDom(node)) {
    // SAFETY: isDom narrowed to a DOM node; dialogs expose the HTMLDialogElement surface.
    const dialog = node as HTMLDialogElement;
    if (!dialog.open) {
      return "closed";
    }
    try {
      return dialog.matches(":modal") ? "modal" : "open";
    } catch {
      return "open";
    }
  }
  // SAFETY: non-DOM inputs are structural Locator nodes; the structural reader tolerates other shapes.
  const element = node as Locator.Node;
  if (structuralReader.prop(element, "open") === "modal") {
    return "modal";
  }
  return dialogOpen(structuralReader, element) ? "open" : "closed";
};

/**
 * Reads a form field's current value: its `value` property, else its
 * `value` attribute. It reads a scene's view, a `TestHost` tree or a DOM
 * element, and returns `undefined` for an element with neither.
 *
 * **When to use**
 *
 * Use to check what a field shows. `.value(text)` sets a property, so the
 * attributes of a story's node don't hold it.
 *
 * **Example** (Checking a search field)
 *
 * ```ts
 * import { DomLocator } from "@ilha/model/test"
 *
 * declare const scene: { get: (locator: unknown) => unknown }
 * const field = scene.get(DomLocator.role("searchbox", { name: "Search" }))
 * console.log(DomLocator.value(field)) // "effect"
 * ```
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- field values come from DOM or structural trees; narrowed with isString below.
export const value = (node: unknown): string | undefined => {
  const reader = readerOf(node);
  const prop = reader.prop(node, "value");
  return isString(prop) ? prop : reader.attr(node, "value");
};

/**
 * Reads whether a checkbox or radio button is checked: `aria-checked` when
 * the element sets it, else an input's `checked` property, else its
 * `checked` attribute. It reads a scene's view, a `TestHost` tree or a DOM
 * element, and returns `undefined` for an element that can't be checked.
 *
 * **When to use**
 *
 * Use to check a box's live state. `.checked(on)` sets a property, so the
 * attributes of a story's node don't hold it. It's the state the `checked`
 * option of `role` matches.
 *
 * **Example** (Checking a done box)
 *
 * ```ts
 * import { DomLocator } from "@ilha/model/test"
 *
 * declare const scene: { get: (locator: unknown) => unknown }
 * const done = scene.get(DomLocator.role("checkbox", { name: "Done" }))
 * console.log(DomLocator.checked(done)) // true
 * ```
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- checked state reads DOM or structural trees; isChecked narrows per field below.
export const checked = (node: unknown): boolean | undefined =>
  isChecked(readerOf(node), node);

/**
 * Whether a popover is showing. It reads a scene's view or a `TestHost`
 * tree, where `.popover(mode, open)` sets `popoverOpen`, or a DOM element,
 * through `:popover-open`.
 *
 * **Example** (Checking a menu)
 *
 * ```ts
 * import { DomLocator } from "@ilha/model/test"
 *
 * declare const scene: { get: (locator: unknown) => unknown }
 * const menu = scene.get(DomLocator.role("menu", { hidden: true }))
 * console.log(DomLocator.popoverState(menu)) // "closed"
 * ```
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- popover state reads DOM or structural trees; popoverOpen narrows per node below.
export const popoverState = (node: unknown): "closed" | "open" =>
  popoverOpen(readerOf(node), node) ? "open" : "closed";

/**
 * Clicks `element` as the user would: a button submits its form, and a
 * checkbox or radio button changes and fires `input` and `change`.
 */
export const click = (element: globalThis.Element): void => {
  // SAFETY: click targets are buttons and inputs; test DOM elements expose the HTMLElement surface.
  (element as HTMLElement).click();
};

/**
 * Types into a text field as the user would: replaces its value with `value`
 * and fires `input`, then `change`.
 */
export const type = (element: globalThis.Element, text: string): void => {
  // SAFETY: type targets are text fields; test DOM elements expose the HTMLInputElement surface.
  const field = element as HTMLInputElement;
  const view = field.ownerDocument.defaultView;
  field.value = text;
  const make = (name: string) =>
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- DOM capability probe: some environments lack InputEvent; construction branches on its presence.
    view !== null && view !== undefined && typeof view.InputEvent === "function"
      ? new view.InputEvent(name, {
          bubbles: true,
          data: text,
          inputType: "insertText",
        })
      : new (view?.Event ?? Event)(name, { bubbles: true });
  field.dispatchEvent(make("input"));
  field.dispatchEvent(new (view?.Event ?? Event)("change", { bubbles: true }));
};

/**
 * Presses `key` on `element`: fires `keydown`, then `keyup`.
 */
export const keydown = (
  element: globalThis.Element,
  key: string,
  modifiers?: {
    readonly shift?: boolean | undefined;
    readonly ctrl?: boolean | undefined;
    readonly alt?: boolean | undefined;
    readonly meta?: boolean | undefined;
  }
): void => {
  const view = element.ownerDocument.defaultView;
  const Keyboard = view?.KeyboardEvent ?? KeyboardEvent;
  const init = {
    altKey: modifiers?.alt === true,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers?.ctrl === true,
    key,
    metaKey: modifiers?.meta === true,
    shiftKey: modifiers?.shift === true,
  };
  element.dispatchEvent(new Keyboard("keydown", init));
  element.dispatchEvent(new Keyboard("keyup", init));
};

/**
 * Submits `form`, or the form `element` belongs to, as pressing Enter in it
 * would.
 */
export const submit = (element: globalThis.Element): void => {
  // SAFETY: submitters are forms or form-owned inputs; non-form elements fall back to the closest form.
  const form =
    element.localName === "form"
      ? (element as HTMLFormElement)
      : ((element as HTMLInputElement).form ?? element.closest("form"));
  if (form === null) {
    throw new Error("DomLocator.submit: the element isn't in a form");
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- DOM capability probe: some environments lack requestSubmit; submission branches on its presence.
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
  } else {
    const view = form.ownerDocument.defaultView;
    form.dispatchEvent(
      new (view?.Event ?? Event)("submit", { bubbles: true, cancelable: true })
    );
  }
};
