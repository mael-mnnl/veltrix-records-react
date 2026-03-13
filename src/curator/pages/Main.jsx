import { useState } from "react";
import Sidebar from "../components/Sidebar";
import PlaylistsPage from "./PlaylistsPage";
import BroadcastPage from "./BroadcastPage";

export default function Main({ user, onLogout }) {
  const [tab, setTab] = useState("playlists");

  return (
    <div className="layout">
      <Sidebar user={user} tab={tab} setTab={setTab} onLogout={onLogout} />
      <div className="main">
        {tab === "playlists" && <PlaylistsPage />}
        {tab === "broadcast" && <BroadcastPage />}
      </div>
    </div>
  );
}
