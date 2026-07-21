"use client";

import { useParams } from "next/navigation";
import { Trailer360Page } from "@/components/dashboard/trailer-360-page";

export default function TrailerDetailsPage() {
  const params = useParams();
  const trailerId = typeof params?.id === "string" ? params.id : "";

  return <Trailer360Page trailerId={trailerId} />;
}
