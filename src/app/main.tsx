import { initializeLanguage } from "../shared/i18n";
import { render } from "solid-js/web";
import { enableObservableTracking } from "mobx-view-model-solid";
import { LibraryPage } from "../pages/library/view";
import "./style.css";

enableObservableTracking();
await initializeLanguage();
render(() => <LibraryPage />, document.getElementById("app")!);
