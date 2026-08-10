import sanitizeHtml from "sanitize-html";

const options: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "h2", "h3", "strong", "em", "s", "u", "blockquote", "ul", "ol", "li", "a", "span", "img", "table", "thead", "tbody", "tr", "th", "td"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    span: ["style"],
    p: ["style"],
    h2: ["style"],
    h3: ["style"],
    img: ["src", "alt", "width", "height", "data-width", "style"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
  },
  allowedStyles: {
    "*": {
      color: [/^#[0-9a-fA-F]{3,8}$/],
      "background-color": [/^#[0-9a-fA-F]{3,8}$/],
      "text-align": [/^(left|center|right)$/],
      width: [/^(25|50|75|100)%$/],
    },
  },
};

export function sanitizeArticleHtml(value: string) {
  return sanitizeHtml(value, options).trim();
}

export function articlePlainText(value: string) {
  const withBoundaries = value.replace(/<\/?(?:p|div|h[1-6]|blockquote|li|tr|th|td|table|ul|ol)\b[^>]*>/gi, " ");
  return sanitizeHtml(withBoundaries, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}

export function extractTokens(value: string) {
  const mentions = [...value.matchAll(/(?:^|\s)@([a-zA-Z0-9._]{3,30})\b/g)].map((match) => match[1]!.toLowerCase());
  const hashtags = [...value.matchAll(/(?:^|\s)#([\p{L}\p{N}_]{1,100})/gu)].map((match) => match[1]!.normalize("NFKC").toLowerCase());
  return { mentions: [...new Set(mentions)], hashtags: [...new Set(hashtags)] };
}
