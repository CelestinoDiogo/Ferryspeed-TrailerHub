import type { ReactNode } from "react";

type PrintTableColumn<T> = {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => ReactNode;
};

type PrintTableProps<T> = {
  columns: Array<PrintTableColumn<T>>;
  rows: T[];
  rowClassName?: (row: T) => string | undefined;
};

export function PrintTable<T>({ columns, rows, rowClassName }: PrintTableProps<T>) {
  return (
    <div className="print-table-wrapper">
      <table className="print-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={rowClassName ? rowClassName(row) : undefined}>
              {columns.map((column) => (
                <td key={column.key} className={column.className}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}