/**
 * CI-only shape for the ExcelJS runtime constructor.
 *
 * The production Edge Function still imports ExcelJS 4.4.0. During `deno check`
 * this lightweight module prevents Deno from loading ExcelJS's legacy type
 * dependency graph, while the function's own ExcelWorkbookLike contract remains
 * fully type-checked.
 */
class Workbook {}

export default { Workbook }
