import { createContext } from "react";
import type { PresentationMode } from "../../shared/presentation/context";

export const GraphModeContext = createContext<PresentationMode>("business");
