import { NewInvoiceForm } from "@/components/NewInvoiceForm";
import { SCENARIOS } from "@/lib/samples";

export default function NewInvoice() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Submit an invoice</h1>
          <div className="sub">Choose a scenario or paste your own text. The agent extracts, checks, and either clears it or routes it to a human.</div>
        </div>
      </div>
      <NewInvoiceForm scenarios={SCENARIOS} />
    </>
  );
}
