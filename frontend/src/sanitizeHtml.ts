/** Strip dangerous markup from chart SVG/HTML before embedding in exported reports. */
const DANGEROUS_TAGS = /<\/?(?:script|iframe|object|embed|link|meta|base|form|foreignObject|foreignobject)[\s>]/gi;
const EVENT_ATTR = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /(?:href|xlink:href|src)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi;

export function sanitizeChartHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  let out = html.replace(DANGEROUS_TAGS, '');
  out = out.replace(EVENT_ATTR, '');
  out = out.replace(JS_URL, '');
  // Drop data: text/html payloads and similar
  out = out.replace(/(?:href|src)\s*=\s*(?:"\s*data:text\/html[^"]*"|'\s*data:text\/html[^']*')/gi, '');
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(`<div id="wrap">${out}</div>`, 'text/html');
      const wrap = doc.getElementById('wrap');
      if (!wrap) return out;
      wrap.querySelectorAll('script, iframe, object, embed, link, meta, base, form').forEach((el) => el.remove());
      wrap.querySelectorAll('*').forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const val = attr.value.trim().toLowerCase();
          if (name.startsWith('on') || val.startsWith('javascript:') || val.startsWith('data:text/html')) {
            el.removeAttribute(attr.name);
          }
        }
      });
      return wrap.innerHTML;
    } catch {
      return out;
    }
  }
  return out;
}
