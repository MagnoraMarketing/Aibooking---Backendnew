import type { Appointment } from "@/types/database";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AppointmentsList({ appointments }: { appointments: Appointment[] }) {
  if (appointments.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        Ingen bookinger endnu.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <ul className="divide-y divide-slate-100">
        {appointments.map((appointment) => (
          <li key={appointment.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {appointment.customer_name || "Ukendt kunde"}
              </p>
              <p className="text-xs text-slate-500">{formatDateTime(appointment.appointment_time)}</p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                appointment.status === "booked" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"
              }`}
            >
              {appointment.status === "booked" ? "Booket" : "Fejlet"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
