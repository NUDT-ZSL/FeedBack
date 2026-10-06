import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import ShipListPage from "@/pages/ShipListPage";
import ShipDetailPage from "@/pages/ShipDetailPage";
import VerifyPage from "@/pages/VerifyPage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ShipListPage />} />
          <Route path="/ships/:shipId" element={<ShipDetailPage />} />
          <Route path="/verify" element={<VerifyPage />} />
        </Route>
      </Routes>
    </Router>
  );
}
