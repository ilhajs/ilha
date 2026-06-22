/**
 * Compile-time check: store field accessors assign to ilha / Areia `bind:*` props.
 */
import type { SignalAccessor } from "ilha";

import { store } from "./index";

const s = store({ email: "" }).build();

const _bindValue: SignalAccessor<string> | undefined = s.email;
const _bindField: SignalAccessor<string> = s.bind((st) => st.email);

void _bindValue;
void _bindField;
