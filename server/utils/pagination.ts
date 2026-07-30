export function parsePagination(
  pageValue: unknown,
  pageSizeValue: unknown,
  defaultPageSize = 20,
  maxPageSize = 100,
) {
  const parsedPage = Number(pageValue)
  const parsedPageSize = Number(pageSizeValue)
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const pageSize = Number.isInteger(parsedPageSize) && parsedPageSize > 0
    ? Math.min(parsedPageSize, maxPageSize)
    : defaultPageSize
  return { page, pageSize, offset: (page - 1) * pageSize }
}
