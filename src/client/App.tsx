import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import DetailPage from "./pages/DetailPage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auction/:id" element={<DetailPage />} />
        <Route path="/orders" element={<OrderPage />} />
      </Routes>
    </Router>
  );
}
