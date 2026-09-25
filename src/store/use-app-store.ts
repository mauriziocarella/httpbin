import { create } from "zustand";

type DetailTab = "payload" | "headers" | "query";
type AppState = {
  selectedInboxId?: string;
  selectedRequestId?: string;
  detailTab: DetailTab;
  mobilePanel: "inboxes" | "events" | "detail";
  selectInbox: (id: string) => void;
  selectRequest: (id?: string) => void;
  setDetailTab: (tab: DetailTab) => void;
  setMobilePanel: (panel: AppState["mobilePanel"]) => void;
};

export const useAppStore = create<AppState>((set) => ({
  detailTab: "payload",
  mobilePanel: "events",
  selectInbox: (id) => set({ selectedInboxId: id, selectedRequestId: undefined, mobilePanel: "events" }),
  selectRequest: (id) => set({ selectedRequestId: id, mobilePanel: id ? "detail" : "events" }),
  setDetailTab: (detailTab) => set({ detailTab }),
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),
}));
