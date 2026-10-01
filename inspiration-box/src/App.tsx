import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import CategoryLibraryPage from "./pages/CategoryLibraryPage";
import BoardPage from "./pages/BoardPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/category/:id" element={<CategoryLibraryPage />} />
          <Route path="/board/:id" element={<BoardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
