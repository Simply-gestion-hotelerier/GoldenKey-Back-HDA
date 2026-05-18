export interface GuestProfile {
  guest: {
    id: number;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    birthDate?: string | null;
    nationality?: string | null;
    company?: string | null;
    notes?: string | null;
    segment?: string | null;
    loyaltyPoints: number;
    loyaltyTier?: string | null;
    createdAt?: string | null;
  };
  stats: {
    totalSpent: number;
    hotelSpent: number;
    spaSpent: number;
    barSpent: number;
    restSpent: number;
    totalStays: number;
    totalSpaVisits: number;
    totalBarVisits: number;
    totalRestVisits: number;
  };
  hotelHistory: HotelStay[];
  spaHistory: SpaVisit[];
  barHistory: BarVisit[];
  restHistory: RestVisit[];
}

export interface HotelStay {
  id: number;
  checkIn: string;
  checkOut: string;
  status: string;
  roomNumber: string;
  roomType: string;
  rate: number;
  rateMode: string;
  folioTotal: number;
  charges: { description: string; qty: number; unitPrice: number; department: string }[];
  payments: { amount: number; method: string; receivedAt: string }[];
}

export interface SpaVisit {
  id: number;
  serviceName: string;
  start: string;
  price: number;
  status: string;
  room?: string | null;
}

export interface BarVisit {
  id: number;
  status: string;
  balance: number;
  totalPaid: number;
}

export interface RestVisit {
  id: number;
  number: string;
  date: string;
  totalTTC: number;
  customerName?: string | null;
  lines: { description: string; qty: number; unitPrice: number }[];
}