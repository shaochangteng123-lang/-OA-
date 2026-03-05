/**
 * HTML utilities
 */

/**
 * Strip HTML tags from a string
 * @param html - HTML string
 * @returns Plain text without HTML tags
 */
export function stripHtmlTags(html: string | undefined): string {
  if (!html) return ''

  // Remove HTML tags
  const text = html.replace(/<[^>]*>/g, '')

  // Decode common HTML entities
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text

  return textarea.value
}

/**
 * Escape HTML characters to prevent XSS attacks
 * @param text - Plain text
 * @returns HTML-escaped string
 */
export function escapeHtml(text: string): string {
  if (!text) return ''

  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  }

  return text.replace(/[&<>"'/]/g, (char) => htmlEscapes[char] || char)
}
