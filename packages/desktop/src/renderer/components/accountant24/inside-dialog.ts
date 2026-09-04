// Whether the current subtree is rendered inside an open dialog. Dialogs that
// can open from either a page or another dialog (the provider connect flows)
// read it to know which backdrop rules apply: Base UI skips a nested dialog's
// backdrop, so they force one there and leave the stock one alone otherwise.

import { createContext } from "react";

export const InsideDialogContext = createContext(false);
