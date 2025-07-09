import * as cheerio from 'cheerio';

/**
 * Extracts text content from HTML tags one by one
 * @param html The HTML content to process
 * @returns Array of objects with tagName, text content, and original HTML element
 */
export function extractTextFromHtml(html: string): Array<{
  text: string;
  path: string;
}> {
  const $ = cheerio.load(html);
  const results: Array<{
    text: string;
    path: string;
  }> = [];

  const getElementPath = (element: any): string => {
    const pathParts: string[] = [];
    let current = element;

    while (current && current.type === 'tag') {
      const tagName = current.name;
      const siblings = $(current).siblings(tagName).toArray();
      const index = siblings.findIndex((sibling) => sibling === current);

      if (index > -1) {
        pathParts.unshift(`${tagName}:nth-child(${index + 1})`);
      } else {
        pathParts.unshift(tagName);
      }

      current = current.parent;
      if (!current || current.name === 'html') break;
    }

    return pathParts.join(' > ');
  };

  $('*').each((_, element) => {
    const $el = $(element);
    const immediateText = $el.contents().filter(function () {
      return this.type === 'text' && $(this).text().trim() !== '';
    });

    if (immediateText.length > 0) {
      immediateText.each((_, textNode) => {
        const text = $(textNode).text().trim();
        if (text) {
          results.push({
            text: text,
            path: getElementPath(element),
          });
        }
      });
    }
  });

  return results;
}
