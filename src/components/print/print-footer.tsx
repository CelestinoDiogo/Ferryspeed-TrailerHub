type PrintFooterProps = {
  notice?: string;
};

export function PrintFooter({ notice = "Confidential / internal operational document." }: PrintFooterProps) {
  return (
    <footer className="print-footer flex items-center justify-between gap-4">
      <p>Ferryspeed TrailerHub</p>
      <p className="print-page-number" />
      <p>{notice}</p>
    </footer>
  );
}