import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/charts/styles.css";
import "./index.css";

import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { LangProvider } from "./i18n";
import { AppDataProvider } from "./context/AppDataContext";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <LangProvider>
      <MantineProvider defaultColorScheme="auto">
        <BrowserRouter>
          <AppDataProvider>
            <App />
          </AppDataProvider>
        </BrowserRouter>
      </MantineProvider>
    </LangProvider>
  </StrictMode>,
);
