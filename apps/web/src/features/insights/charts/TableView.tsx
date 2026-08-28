export interface TableColumn<TRow> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: TRow) => string;
  /** Numbers align right so a column of them can be compared down the page. */
  readonly numeric?: boolean;
}

export interface TableViewProps<TRow> {
  readonly caption: string;
  readonly columns: readonly TableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly rowKey: (row: TRow, index: number) => string;
}

/**
 * The table twin.
 *
 * Every chart in this feature has one, and it is not a fallback — it is the
 * WCAG-clean equivalent of the same data, reachable by anyone who would rather read
 * numbers than a picture, or who cannot see the picture. Colour, position and shape
 * all stop carrying meaning here; the numbers carry it.
 */
export function TableView<TRow>({ caption, columns, rows, rowKey }: TableViewProps<TRow>) {
  return (
    <div className="ff-in-tablewrap">
      <table className="ff-in-table">
        <caption className="ff-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric === true ? 'ff-in-num' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric === true ? 'ff-in-num' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
