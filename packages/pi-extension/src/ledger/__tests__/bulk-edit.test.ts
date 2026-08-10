import { describe, expect, test } from "vitest";
import { bulkEditTransactions } from "../bulk-edit";

// The bulk_edit_transactions tool pre-checks `from` with its own schema-named
// message, so these ledger-layer guards are unreachable through the tool. They
// are still part of bulkEditTransactions' public contract — cover them directly.
describe("bulkEditTransactions() validation", () => {
  test("should require from_account when field is account", async () => {
    await expect(
      bulkEditTransactions(["payee:X"], { field: "account", new_value: "expenses:food:groceries" }),
    ).rejects.toThrow('from_account is required when field is "account"');
  });

  test("should require from_payee when field is payee", async () => {
    await expect(bulkEditTransactions(["payee:X"], { field: "payee", new_value: "EDEKA" })).rejects.toThrow(
      'from_payee is required when field is "payee"',
    );
  });
});
