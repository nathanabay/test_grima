/**
 * Demo data seed (§69).
 *
 * Creates a realistic pharmacy chain: 5 branches, 5 warehouses, 20 suppliers,
 * 100 medicines with genuine generic/brand names, batches spanning expired,
 * near-expiry and long-dated stock, plus purchase orders, transfers,
 * prescriptions, sales, cold-chain sensors and a worked recall example.
 *
 * Deterministic: a fixed PRNG seed means every run produces the same dataset,
 * so demos and tests are reproducible.
 */

import { loadEnv } from '../src/common/config/env';

// The seed runs from apps/api while .env lives at the repository root (§65).
loadEnv(__dirname);

import { PrismaClient, Prisma, BatchStatus, PaymentMethod } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  DEFAULT_ROLES,
  RESOURCE_CATALOG,
  permissionCode,
  resolveRolePermissions,
} from '@pharmacore/shared';

const prisma = new PrismaClient();

// ---- Deterministic PRNG (mulberry32) so seeds are reproducible ----
let prngState = 0x9e3779b9;
function random(): number {
  prngState |= 0;
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(random() * arr.length)];
}
function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}
function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

// ---- Drug master source data ----

interface DrugSeed {
  generic: string;
  brand: string;
  ingredient: string;
  strength: string;
  form: string;
  atc: string;
  category: string;
  therapeutic: string;
  rx: boolean;
  controlled?: boolean;
  coldChain?: boolean;
  highAlert?: boolean;
  cost: number;
  price: number;
  baseUnit: string;
}

const DRUGS: DrugSeed[] = [
  { generic: 'Amoxicillin', brand: 'Amoxil', ingredient: 'Amoxicillin trihydrate', strength: '500 mg', form: 'Capsule', atc: 'J01CA04', category: 'ANTIBIOTIC', therapeutic: 'Penicillin antibacterial', rx: true, cost: 2.4, price: 4.5, baseUnit: 'CAPSULE' },
  { generic: 'Amoxicillin + Clavulanic acid', brand: 'Augmentin', ingredient: 'Amoxicillin/Clavulanate', strength: '625 mg', form: 'Tablet', atc: 'J01CR02', category: 'ANTIBIOTIC', therapeutic: 'Beta-lactam combination', rx: true, cost: 8.2, price: 14.5, baseUnit: 'TABLET' },
  { generic: 'Azithromycin', brand: 'Zithromax', ingredient: 'Azithromycin dihydrate', strength: '500 mg', form: 'Tablet', atc: 'J01FA10', category: 'ANTIBIOTIC', therapeutic: 'Macrolide antibacterial', rx: true, cost: 12.0, price: 21.0, baseUnit: 'TABLET' },
  { generic: 'Ciprofloxacin', brand: 'Cipro', ingredient: 'Ciprofloxacin hydrochloride', strength: '500 mg', form: 'Tablet', atc: 'J01MA02', category: 'ANTIBIOTIC', therapeutic: 'Fluoroquinolone', rx: true, cost: 3.6, price: 6.75, baseUnit: 'TABLET' },
  { generic: 'Ceftriaxone', brand: 'Rocephin', ingredient: 'Ceftriaxone sodium', strength: '1 g', form: 'Injection', atc: 'J01DD04', category: 'ANTIBIOTIC', therapeutic: 'Third-generation cephalosporin', rx: true, cost: 22.0, price: 38.0, baseUnit: 'VIAL' },
  { generic: 'Doxycycline', brand: 'Vibramycin', ingredient: 'Doxycycline hyclate', strength: '100 mg', form: 'Capsule', atc: 'J01AA02', category: 'ANTIBIOTIC', therapeutic: 'Tetracycline', rx: true, cost: 2.1, price: 4.0, baseUnit: 'CAPSULE' },
  { generic: 'Metronidazole', brand: 'Flagyl', ingredient: 'Metronidazole', strength: '400 mg', form: 'Tablet', atc: 'J01XD01', category: 'ANTIBIOTIC', therapeutic: 'Nitroimidazole', rx: true, cost: 1.2, price: 2.5, baseUnit: 'TABLET' },
  { generic: 'Cloxacillin', brand: 'Orbenin', ingredient: 'Cloxacillin sodium', strength: '500 mg', form: 'Capsule', atc: 'J01CF02', category: 'ANTIBIOTIC', therapeutic: 'Penicillinase-resistant penicillin', rx: true, cost: 2.8, price: 5.2, baseUnit: 'CAPSULE' },
  { generic: 'Cefixime', brand: 'Suprax', ingredient: 'Cefixime trihydrate', strength: '200 mg', form: 'Tablet', atc: 'J01DD08', category: 'ANTIBIOTIC', therapeutic: 'Cephalosporin', rx: true, cost: 9.5, price: 16.0, baseUnit: 'TABLET' },
  { generic: 'Gentamicin', brand: 'Garamycin', ingredient: 'Gentamicin sulfate', strength: '80 mg/2 ml', form: 'Injection', atc: 'J01GB03', category: 'ANTIBIOTIC', therapeutic: 'Aminoglycoside', rx: true, highAlert: true, cost: 6.0, price: 11.0, baseUnit: 'AMPOULE' },

  { generic: 'Paracetamol', brand: 'Panadol', ingredient: 'Paracetamol', strength: '500 mg', form: 'Tablet', atc: 'N02BE01', category: 'ANALGESIC', therapeutic: 'Non-opioid analgesic', rx: false, cost: 0.35, price: 0.9, baseUnit: 'TABLET' },
  { generic: 'Ibuprofen', brand: 'Brufen', ingredient: 'Ibuprofen', strength: '400 mg', form: 'Tablet', atc: 'M01AE01', category: 'ANALGESIC', therapeutic: 'NSAID', rx: false, cost: 0.6, price: 1.5, baseUnit: 'TABLET' },
  { generic: 'Diclofenac', brand: 'Voltaren', ingredient: 'Diclofenac sodium', strength: '50 mg', form: 'Tablet', atc: 'M01AB05', category: 'ANALGESIC', therapeutic: 'NSAID', rx: false, cost: 0.8, price: 1.8, baseUnit: 'TABLET' },
  { generic: 'Aspirin', brand: 'Aspirin Cardio', ingredient: 'Acetylsalicylic acid', strength: '75 mg', form: 'Tablet', atc: 'B01AC06', category: 'CARDIOVASCULAR', therapeutic: 'Antiplatelet', rx: false, cost: 0.4, price: 1.1, baseUnit: 'TABLET' },
  { generic: 'Tramadol', brand: 'Tramal', ingredient: 'Tramadol hydrochloride', strength: '50 mg', form: 'Capsule', atc: 'N02AX02', category: 'ANALGESIC', therapeutic: 'Opioid analgesic', rx: true, controlled: true, cost: 3.2, price: 6.5, baseUnit: 'CAPSULE' },
  { generic: 'Morphine', brand: 'MST Continus', ingredient: 'Morphine sulfate', strength: '10 mg', form: 'Tablet', atc: 'N02AA01', category: 'ANALGESIC', therapeutic: 'Opioid analgesic', rx: true, controlled: true, highAlert: true, cost: 14.0, price: 26.0, baseUnit: 'TABLET' },
  { generic: 'Codeine + Paracetamol', brand: 'Co-codamol', ingredient: 'Codeine phosphate/Paracetamol', strength: '30/500 mg', form: 'Tablet', atc: 'N02AJ06', category: 'ANALGESIC', therapeutic: 'Opioid combination', rx: true, controlled: true, cost: 2.6, price: 5.4, baseUnit: 'TABLET' },
  { generic: 'Diazepam', brand: 'Valium', ingredient: 'Diazepam', strength: '5 mg', form: 'Tablet', atc: 'N05BA01', category: 'CNS', therapeutic: 'Benzodiazepine', rx: true, controlled: true, cost: 1.8, price: 4.2, baseUnit: 'TABLET' },
  { generic: 'Phenobarbital', brand: 'Luminal', ingredient: 'Phenobarbital', strength: '30 mg', form: 'Tablet', atc: 'N03AA02', category: 'CNS', therapeutic: 'Barbiturate anticonvulsant', rx: true, controlled: true, cost: 1.4, price: 3.2, baseUnit: 'TABLET' },

  { generic: 'Metformin', brand: 'Glucophage', ingredient: 'Metformin hydrochloride', strength: '500 mg', form: 'Tablet', atc: 'A10BA02', category: 'ANTIDIABETIC', therapeutic: 'Biguanide', rx: true, cost: 0.9, price: 2.1, baseUnit: 'TABLET' },
  { generic: 'Glibenclamide', brand: 'Daonil', ingredient: 'Glibenclamide', strength: '5 mg', form: 'Tablet', atc: 'A10BB01', category: 'ANTIDIABETIC', therapeutic: 'Sulfonylurea', rx: true, cost: 0.7, price: 1.7, baseUnit: 'TABLET' },
  { generic: 'Insulin glargine', brand: 'Lantus', ingredient: 'Insulin glargine', strength: '100 IU/ml', form: 'Injection', atc: 'A10AE04', category: 'ANTIDIABETIC', therapeutic: 'Long-acting insulin', rx: true, coldChain: true, highAlert: true, cost: 320.0, price: 480.0, baseUnit: 'PEN' },
  { generic: 'Insulin human', brand: 'Actrapid', ingredient: 'Insulin human', strength: '100 IU/ml', form: 'Injection', atc: 'A10AB01', category: 'ANTIDIABETIC', therapeutic: 'Short-acting insulin', rx: true, coldChain: true, highAlert: true, cost: 210.0, price: 320.0, baseUnit: 'VIAL' },
  { generic: 'Gliclazide', brand: 'Diamicron', ingredient: 'Gliclazide', strength: '60 mg', form: 'Tablet', atc: 'A10BB09', category: 'ANTIDIABETIC', therapeutic: 'Sulfonylurea', rx: true, cost: 2.2, price: 4.4, baseUnit: 'TABLET' },

  { generic: 'Amlodipine', brand: 'Norvasc', ingredient: 'Amlodipine besylate', strength: '5 mg', form: 'Tablet', atc: 'C08CA01', category: 'CARDIOVASCULAR', therapeutic: 'Calcium channel blocker', rx: true, cost: 1.1, price: 2.6, baseUnit: 'TABLET' },
  { generic: 'Enalapril', brand: 'Renitec', ingredient: 'Enalapril maleate', strength: '10 mg', form: 'Tablet', atc: 'C09AA02', category: 'CARDIOVASCULAR', therapeutic: 'ACE inhibitor', rx: true, cost: 1.0, price: 2.3, baseUnit: 'TABLET' },
  { generic: 'Losartan', brand: 'Cozaar', ingredient: 'Losartan potassium', strength: '50 mg', form: 'Tablet', atc: 'C09CA01', category: 'CARDIOVASCULAR', therapeutic: 'Angiotensin II antagonist', rx: true, cost: 1.9, price: 4.0, baseUnit: 'TABLET' },
  { generic: 'Atenolol', brand: 'Tenormin', ingredient: 'Atenolol', strength: '50 mg', form: 'Tablet', atc: 'C07AB03', category: 'CARDIOVASCULAR', therapeutic: 'Beta blocker', rx: true, cost: 0.8, price: 1.9, baseUnit: 'TABLET' },
  { generic: 'Bisoprolol', brand: 'Concor', ingredient: 'Bisoprolol fumarate', strength: '5 mg', form: 'Tablet', atc: 'C07AB07', category: 'CARDIOVASCULAR', therapeutic: 'Beta blocker', rx: true, cost: 1.6, price: 3.4, baseUnit: 'TABLET' },
  { generic: 'Hydrochlorothiazide', brand: 'Esidrex', ingredient: 'Hydrochlorothiazide', strength: '25 mg', form: 'Tablet', atc: 'C03AA03', category: 'CARDIOVASCULAR', therapeutic: 'Thiazide diuretic', rx: true, cost: 0.5, price: 1.3, baseUnit: 'TABLET' },
  { generic: 'Furosemide', brand: 'Lasix', ingredient: 'Furosemide', strength: '40 mg', form: 'Tablet', atc: 'C03CA01', category: 'CARDIOVASCULAR', therapeutic: 'Loop diuretic', rx: true, cost: 0.6, price: 1.5, baseUnit: 'TABLET' },
  { generic: 'Atorvastatin', brand: 'Lipitor', ingredient: 'Atorvastatin calcium', strength: '20 mg', form: 'Tablet', atc: 'C10AA05', category: 'CARDIOVASCULAR', therapeutic: 'Statin', rx: true, cost: 2.4, price: 5.0, baseUnit: 'TABLET' },
  { generic: 'Simvastatin', brand: 'Zocor', ingredient: 'Simvastatin', strength: '20 mg', form: 'Tablet', atc: 'C10AA01', category: 'CARDIOVASCULAR', therapeutic: 'Statin', rx: true, cost: 1.8, price: 3.9, baseUnit: 'TABLET' },
  { generic: 'Warfarin', brand: 'Coumadin', ingredient: 'Warfarin sodium', strength: '5 mg', form: 'Tablet', atc: 'B01AA03', category: 'CARDIOVASCULAR', therapeutic: 'Vitamin K antagonist', rx: true, highAlert: true, cost: 1.5, price: 3.5, baseUnit: 'TABLET' },
  { generic: 'Clopidogrel', brand: 'Plavix', ingredient: 'Clopidogrel bisulfate', strength: '75 mg', form: 'Tablet', atc: 'B01AC04', category: 'CARDIOVASCULAR', therapeutic: 'Antiplatelet', rx: true, cost: 3.8, price: 7.2, baseUnit: 'TABLET' },
  { generic: 'Digoxin', brand: 'Lanoxin', ingredient: 'Digoxin', strength: '0.25 mg', form: 'Tablet', atc: 'C01AA05', category: 'CARDIOVASCULAR', therapeutic: 'Cardiac glycoside', rx: true, highAlert: true, cost: 1.2, price: 2.9, baseUnit: 'TABLET' },

  { generic: 'Omeprazole', brand: 'Losec', ingredient: 'Omeprazole', strength: '20 mg', form: 'Capsule', atc: 'A02BC01', category: 'GASTROINTESTINAL', therapeutic: 'Proton pump inhibitor', rx: false, cost: 1.3, price: 3.0, baseUnit: 'CAPSULE' },
  { generic: 'Ranitidine', brand: 'Zantac', ingredient: 'Ranitidine hydrochloride', strength: '150 mg', form: 'Tablet', atc: 'A02BA02', category: 'GASTROINTESTINAL', therapeutic: 'H2 antagonist', rx: false, cost: 0.9, price: 2.2, baseUnit: 'TABLET' },
  { generic: 'Metoclopramide', brand: 'Maxolon', ingredient: 'Metoclopramide hydrochloride', strength: '10 mg', form: 'Tablet', atc: 'A03FA01', category: 'GASTROINTESTINAL', therapeutic: 'Prokinetic antiemetic', rx: true, cost: 0.7, price: 1.7, baseUnit: 'TABLET' },
  { generic: 'Ondansetron', brand: 'Zofran', ingredient: 'Ondansetron hydrochloride', strength: '4 mg', form: 'Tablet', atc: 'A04AA01', category: 'GASTROINTESTINAL', therapeutic: '5-HT3 antagonist', rx: true, cost: 4.5, price: 8.5, baseUnit: 'TABLET' },
  { generic: 'Oral rehydration salts', brand: 'ORS', ingredient: 'Glucose/Electrolytes', strength: '20.5 g', form: 'Powder', atc: 'A07CA', category: 'GASTROINTESTINAL', therapeutic: 'Rehydration', rx: false, cost: 1.0, price: 2.5, baseUnit: 'SACHET' },
  { generic: 'Loperamide', brand: 'Imodium', ingredient: 'Loperamide hydrochloride', strength: '2 mg', form: 'Capsule', atc: 'A07DA03', category: 'GASTROINTESTINAL', therapeutic: 'Antidiarrhoeal', rx: false, cost: 0.8, price: 2.0, baseUnit: 'CAPSULE' },
  { generic: 'Hyoscine butylbromide', brand: 'Buscopan', ingredient: 'Hyoscine butylbromide', strength: '10 mg', form: 'Tablet', atc: 'A03BB01', category: 'GASTROINTESTINAL', therapeutic: 'Antispasmodic', rx: false, cost: 1.1, price: 2.6, baseUnit: 'TABLET' },

  { generic: 'Salbutamol', brand: 'Ventolin', ingredient: 'Salbutamol sulfate', strength: '100 mcg/dose', form: 'Inhaler', atc: 'R03AC02', category: 'RESPIRATORY', therapeutic: 'Short-acting beta agonist', rx: true, cost: 45.0, price: 78.0, baseUnit: 'INHALER' },
  { generic: 'Beclometasone', brand: 'Becotide', ingredient: 'Beclometasone dipropionate', strength: '200 mcg/dose', form: 'Inhaler', atc: 'R03BA01', category: 'RESPIRATORY', therapeutic: 'Inhaled corticosteroid', rx: true, cost: 62.0, price: 98.0, baseUnit: 'INHALER' },
  { generic: 'Cetirizine', brand: 'Zyrtec', ingredient: 'Cetirizine dihydrochloride', strength: '10 mg', form: 'Tablet', atc: 'R06AE07', category: 'RESPIRATORY', therapeutic: 'Antihistamine', rx: false, cost: 0.7, price: 1.8, baseUnit: 'TABLET' },
  { generic: 'Loratadine', brand: 'Claritin', ingredient: 'Loratadine', strength: '10 mg', form: 'Tablet', atc: 'R06AX13', category: 'RESPIRATORY', therapeutic: 'Antihistamine', rx: false, cost: 0.8, price: 2.0, baseUnit: 'TABLET' },
  { generic: 'Chlorphenamine', brand: 'Piriton', ingredient: 'Chlorphenamine maleate', strength: '4 mg', form: 'Tablet', atc: 'R06AB04', category: 'RESPIRATORY', therapeutic: 'Antihistamine', rx: false, cost: 0.3, price: 0.9, baseUnit: 'TABLET' },
  { generic: 'Aminophylline', brand: 'Phyllocontin', ingredient: 'Aminophylline', strength: '225 mg', form: 'Tablet', atc: 'R03DA05', category: 'RESPIRATORY', therapeutic: 'Xanthine bronchodilator', rx: true, cost: 1.4, price: 3.1, baseUnit: 'TABLET' },

  { generic: 'Artemether + Lumefantrine', brand: 'Coartem', ingredient: 'Artemether/Lumefantrine', strength: '20/120 mg', form: 'Tablet', atc: 'P01BF01', category: 'ANTIMALARIAL', therapeutic: 'Artemisinin combination therapy', rx: true, cost: 3.5, price: 6.8, baseUnit: 'TABLET' },
  { generic: 'Chloroquine', brand: 'Nivaquine', ingredient: 'Chloroquine phosphate', strength: '250 mg', form: 'Tablet', atc: 'P01BA01', category: 'ANTIMALARIAL', therapeutic: '4-aminoquinoline', rx: true, cost: 0.9, price: 2.1, baseUnit: 'TABLET' },
  { generic: 'Quinine', brand: 'Quinimax', ingredient: 'Quinine sulfate', strength: '300 mg', form: 'Tablet', atc: 'P01BC01', category: 'ANTIMALARIAL', therapeutic: 'Cinchona alkaloid', rx: true, cost: 2.0, price: 4.2, baseUnit: 'TABLET' },
  { generic: 'Albendazole', brand: 'Zentel', ingredient: 'Albendazole', strength: '400 mg', form: 'Tablet', atc: 'P02CA03', category: 'ANTIPARASITIC', therapeutic: 'Anthelmintic', rx: false, cost: 1.5, price: 3.4, baseUnit: 'TABLET' },
  { generic: 'Mebendazole', brand: 'Vermox', ingredient: 'Mebendazole', strength: '100 mg', form: 'Tablet', atc: 'P02CA01', category: 'ANTIPARASITIC', therapeutic: 'Anthelmintic', rx: false, cost: 1.1, price: 2.6, baseUnit: 'TABLET' },
  { generic: 'Praziquantel', brand: 'Biltricide', ingredient: 'Praziquantel', strength: '600 mg', form: 'Tablet', atc: 'P02BA01', category: 'ANTIPARASITIC', therapeutic: 'Anthelmintic', rx: true, cost: 6.5, price: 12.0, baseUnit: 'TABLET' },

  { generic: 'Tenofovir + Lamivudine + Dolutegravir', brand: 'TLD', ingredient: 'TDF/3TC/DTG', strength: '300/300/50 mg', form: 'Tablet', atc: 'J05AR27', category: 'ANTIRETROVIRAL', therapeutic: 'HIV combination therapy', rx: true, cost: 18.0, price: 0, baseUnit: 'TABLET' },
  { generic: 'Nevirapine', brand: 'Viramune', ingredient: 'Nevirapine', strength: '200 mg', form: 'Tablet', atc: 'J05AG01', category: 'ANTIRETROVIRAL', therapeutic: 'NNRTI', rx: true, cost: 4.2, price: 0, baseUnit: 'TABLET' },
  { generic: 'Zidovudine + Lamivudine', brand: 'Combivir', ingredient: 'AZT/3TC', strength: '300/150 mg', form: 'Tablet', atc: 'J05AR01', category: 'ANTIRETROVIRAL', therapeutic: 'NRTI combination', rx: true, cost: 9.0, price: 0, baseUnit: 'TABLET' },
  { generic: 'Isoniazid', brand: 'Isozid', ingredient: 'Isoniazid', strength: '300 mg', form: 'Tablet', atc: 'J04AC01', category: 'ANTITUBERCULAR', therapeutic: 'Antitubercular', rx: true, cost: 1.2, price: 0, baseUnit: 'TABLET' },
  { generic: 'Rifampicin + Isoniazid', brand: 'Rifinah', ingredient: 'Rifampicin/Isoniazid', strength: '150/75 mg', form: 'Tablet', atc: 'J04AM02', category: 'ANTITUBERCULAR', therapeutic: 'Fixed-dose antitubercular', rx: true, cost: 2.8, price: 0, baseUnit: 'TABLET' },
  { generic: 'Ethambutol', brand: 'Myambutol', ingredient: 'Ethambutol hydrochloride', strength: '400 mg', form: 'Tablet', atc: 'J04AK02', category: 'ANTITUBERCULAR', therapeutic: 'Antitubercular', rx: true, cost: 1.6, price: 0, baseUnit: 'TABLET' },
  { generic: 'Pyrazinamide', brand: 'Zinamide', ingredient: 'Pyrazinamide', strength: '500 mg', form: 'Tablet', atc: 'J04AK01', category: 'ANTITUBERCULAR', therapeutic: 'Antitubercular', rx: true, cost: 1.4, price: 0, baseUnit: 'TABLET' },

  { generic: 'Fluconazole', brand: 'Diflucan', ingredient: 'Fluconazole', strength: '150 mg', form: 'Capsule', atc: 'J02AC01', category: 'ANTIFUNGAL', therapeutic: 'Triazole antifungal', rx: true, cost: 5.5, price: 10.0, baseUnit: 'CAPSULE' },
  { generic: 'Ketoconazole', brand: 'Nizoral', ingredient: 'Ketoconazole', strength: '2%', form: 'Cream', atc: 'D01AC08', category: 'ANTIFUNGAL', therapeutic: 'Topical antifungal', rx: false, cost: 12.0, price: 22.0, baseUnit: 'TUBE' },
  { generic: 'Clotrimazole', brand: 'Canesten', ingredient: 'Clotrimazole', strength: '1%', form: 'Cream', atc: 'D01AC01', category: 'ANTIFUNGAL', therapeutic: 'Topical antifungal', rx: false, cost: 9.0, price: 17.0, baseUnit: 'TUBE' },
  { generic: 'Griseofulvin', brand: 'Grisovin', ingredient: 'Griseofulvin', strength: '500 mg', form: 'Tablet', atc: 'D01BA01', category: 'ANTIFUNGAL', therapeutic: 'Systemic antifungal', rx: true, cost: 3.0, price: 6.0, baseUnit: 'TABLET' },
  { generic: 'Aciclovir', brand: 'Zovirax', ingredient: 'Aciclovir', strength: '400 mg', form: 'Tablet', atc: 'J05AB01', category: 'ANTIVIRAL', therapeutic: 'Nucleoside antiviral', rx: true, cost: 2.7, price: 5.6, baseUnit: 'TABLET' },

  { generic: 'Prednisolone', brand: 'Deltacortril', ingredient: 'Prednisolone', strength: '5 mg', form: 'Tablet', atc: 'H02AB06', category: 'HORMONE', therapeutic: 'Corticosteroid', rx: true, cost: 0.6, price: 1.6, baseUnit: 'TABLET' },
  { generic: 'Dexamethasone', brand: 'Decadron', ingredient: 'Dexamethasone sodium phosphate', strength: '4 mg/ml', form: 'Injection', atc: 'H02AB02', category: 'HORMONE', therapeutic: 'Corticosteroid', rx: true, cost: 4.0, price: 8.0, baseUnit: 'AMPOULE' },
  { generic: 'Hydrocortisone', brand: 'Solu-Cortef', ingredient: 'Hydrocortisone sodium succinate', strength: '100 mg', form: 'Injection', atc: 'H02AB09', category: 'HORMONE', therapeutic: 'Corticosteroid', rx: true, cost: 18.0, price: 31.0, baseUnit: 'VIAL' },
  { generic: 'Levothyroxine', brand: 'Eltroxin', ingredient: 'Levothyroxine sodium', strength: '50 mcg', form: 'Tablet', atc: 'H03AA01', category: 'HORMONE', therapeutic: 'Thyroid hormone', rx: true, cost: 1.0, price: 2.4, baseUnit: 'TABLET' },
  { generic: 'Medroxyprogesterone', brand: 'Depo-Provera', ingredient: 'Medroxyprogesterone acetate', strength: '150 mg/ml', form: 'Injection', atc: 'G03AC06', category: 'HORMONE', therapeutic: 'Injectable contraceptive', rx: true, cost: 24.0, price: 42.0, baseUnit: 'VIAL' },
  { generic: 'Levonorgestrel + Ethinylestradiol', brand: 'Microgynon', ingredient: 'Levonorgestrel/Ethinylestradiol', strength: '150/30 mcg', form: 'Tablet', atc: 'G03AA07', category: 'HORMONE', therapeutic: 'Combined oral contraceptive', rx: true, cost: 0.9, price: 2.2, baseUnit: 'TABLET' },
  { generic: 'Oxytocin', brand: 'Syntocinon', ingredient: 'Oxytocin', strength: '10 IU/ml', form: 'Injection', atc: 'H01BB02', category: 'HORMONE', therapeutic: 'Uterotonic', rx: true, coldChain: true, highAlert: true, cost: 8.0, price: 15.0, baseUnit: 'AMPOULE' },
  { generic: 'Misoprostol', brand: 'Cytotec', ingredient: 'Misoprostol', strength: '200 mcg', form: 'Tablet', atc: 'G02AD06', category: 'HORMONE', therapeutic: 'Prostaglandin', rx: true, highAlert: true, cost: 6.0, price: 11.0, baseUnit: 'TABLET' },

  { generic: 'Ferrous sulfate + Folic acid', brand: 'Fefol', ingredient: 'Ferrous sulfate/Folic acid', strength: '200/0.4 mg', form: 'Tablet', atc: 'B03AD03', category: 'SUPPLEMENT', therapeutic: 'Haematinic', rx: false, cost: 0.4, price: 1.2, baseUnit: 'TABLET' },
  { generic: 'Folic acid', brand: 'Folvite', ingredient: 'Folic acid', strength: '5 mg', form: 'Tablet', atc: 'B03BB01', category: 'SUPPLEMENT', therapeutic: 'Vitamin', rx: false, cost: 0.25, price: 0.8, baseUnit: 'TABLET' },
  { generic: 'Vitamin A', brand: 'Retinol', ingredient: 'Retinol palmitate', strength: '200000 IU', form: 'Capsule', atc: 'A11CA01', category: 'SUPPLEMENT', therapeutic: 'Vitamin', rx: false, cost: 0.9, price: 2.2, baseUnit: 'CAPSULE' },
  { generic: 'Vitamin C', brand: 'Ascorbic acid', ingredient: 'Ascorbic acid', strength: '500 mg', form: 'Tablet', atc: 'A11GA01', category: 'SUPPLEMENT', therapeutic: 'Vitamin', rx: false, cost: 0.3, price: 1.0, baseUnit: 'TABLET' },
  { generic: 'Multivitamin', brand: 'Pharmaton', ingredient: 'Multivitamin complex', strength: 'Adult', form: 'Capsule', atc: 'A11AA03', category: 'SUPPLEMENT', therapeutic: 'Vitamin supplement', rx: false, cost: 2.5, price: 5.5, baseUnit: 'CAPSULE' },
  { generic: 'Calcium + Vitamin D3', brand: 'Calcichew', ingredient: 'Calcium carbonate/Cholecalciferol', strength: '500 mg/200 IU', form: 'Tablet', atc: 'A12AX', category: 'SUPPLEMENT', therapeutic: 'Mineral supplement', rx: false, cost: 1.2, price: 3.0, baseUnit: 'TABLET' },
  { generic: 'Zinc sulfate', brand: 'Zincovit', ingredient: 'Zinc sulfate monohydrate', strength: '20 mg', form: 'Tablet', atc: 'A12CB01', category: 'SUPPLEMENT', therapeutic: 'Mineral supplement', rx: false, cost: 0.5, price: 1.4, baseUnit: 'TABLET' },

  { generic: 'BCG vaccine', brand: 'BCG', ingredient: 'Bacillus Calmette-Guerin', strength: '0.05 mg', form: 'Injection', atc: 'J07AN01', category: 'VACCINE', therapeutic: 'Live attenuated vaccine', rx: true, coldChain: true, cost: 15.0, price: 0, baseUnit: 'VIAL' },
  { generic: 'Measles vaccine', brand: 'Measles', ingredient: 'Live attenuated measles virus', strength: '0.5 ml', form: 'Injection', atc: 'J07BD01', category: 'VACCINE', therapeutic: 'Live attenuated vaccine', rx: true, coldChain: true, cost: 18.0, price: 0, baseUnit: 'VIAL' },
  { generic: 'Tetanus toxoid', brand: 'TT', ingredient: 'Tetanus toxoid adsorbed', strength: '0.5 ml', form: 'Injection', atc: 'J07AM01', category: 'VACCINE', therapeutic: 'Toxoid vaccine', rx: true, coldChain: true, cost: 12.0, price: 0, baseUnit: 'VIAL' },
  { generic: 'Hepatitis B vaccine', brand: 'Engerix-B', ingredient: 'Hepatitis B surface antigen', strength: '20 mcg', form: 'Injection', atc: 'J07BC01', category: 'VACCINE', therapeutic: 'Recombinant vaccine', rx: true, coldChain: true, cost: 85.0, price: 140.0, baseUnit: 'VIAL' },
  { generic: 'Rabies vaccine', brand: 'Verorab', ingredient: 'Inactivated rabies virus', strength: '0.5 ml', form: 'Injection', atc: 'J07BG01', category: 'VACCINE', therapeutic: 'Inactivated vaccine', rx: true, coldChain: true, cost: 320.0, price: 480.0, baseUnit: 'VIAL' },

  { generic: 'Sodium chloride', brand: 'Normal Saline', ingredient: 'Sodium chloride 0.9%', strength: '500 ml', form: 'Infusion', atc: 'B05CB01', category: 'IV_FLUID', therapeutic: 'Crystalloid', rx: true, cost: 22.0, price: 38.0, baseUnit: 'BAG' },
  { generic: 'Dextrose', brand: 'Dextrose 5%', ingredient: 'Glucose 5%', strength: '500 ml', form: 'Infusion', atc: 'B05BA03', category: 'IV_FLUID', therapeutic: 'Carbohydrate infusion', rx: true, cost: 24.0, price: 40.0, baseUnit: 'BAG' },
  { generic: 'Ringer lactate', brand: 'Hartmann', ingredient: 'Compound sodium lactate', strength: '500 ml', form: 'Infusion', atc: 'B05BB01', category: 'IV_FLUID', therapeutic: 'Crystalloid', rx: true, cost: 26.0, price: 44.0, baseUnit: 'BAG' },
  { generic: 'Water for injection', brand: 'WFI', ingredient: 'Sterile water', strength: '10 ml', form: 'Injection', atc: 'V07AB', category: 'IV_FLUID', therapeutic: 'Diluent', rx: false, cost: 1.0, price: 2.5, baseUnit: 'AMPOULE' },

  { generic: 'Silver sulfadiazine', brand: 'Flamazine', ingredient: 'Silver sulfadiazine', strength: '1%', form: 'Cream', atc: 'D06BA01', category: 'DERMATOLOGICAL', therapeutic: 'Topical antibacterial', rx: true, cost: 28.0, price: 48.0, baseUnit: 'TUBE' },
  { generic: 'Betamethasone', brand: 'Betnovate', ingredient: 'Betamethasone valerate', strength: '0.1%', form: 'Cream', atc: 'D07AC01', category: 'DERMATOLOGICAL', therapeutic: 'Topical corticosteroid', rx: true, cost: 14.0, price: 26.0, baseUnit: 'TUBE' },
  { generic: 'Calamine', brand: 'Calamine Lotion', ingredient: 'Calamine/Zinc oxide', strength: '100 ml', form: 'Lotion', atc: 'D02AB', category: 'DERMATOLOGICAL', therapeutic: 'Topical soothing agent', rx: false, cost: 8.0, price: 16.0, baseUnit: 'BOTTLE' },
  { generic: 'Benzyl benzoate', brand: 'Ascabiol', ingredient: 'Benzyl benzoate', strength: '25%', form: 'Lotion', atc: 'P03AX01', category: 'DERMATOLOGICAL', therapeutic: 'Scabicide', rx: false, cost: 10.0, price: 19.0, baseUnit: 'BOTTLE' },
  { generic: 'Povidone iodine', brand: 'Betadine', ingredient: 'Povidone iodine', strength: '10%', form: 'Solution', atc: 'D08AG02', category: 'DERMATOLOGICAL', therapeutic: 'Antiseptic', rx: false, cost: 16.0, price: 29.0, baseUnit: 'BOTTLE' },

  { generic: 'Timolol', brand: 'Timoptol', ingredient: 'Timolol maleate', strength: '0.5%', form: 'Eye drops', atc: 'S01ED01', category: 'OPHTHALMIC', therapeutic: 'Beta blocker eye drop', rx: true, cost: 26.0, price: 45.0, baseUnit: 'BOTTLE' },
  { generic: 'Chloramphenicol', brand: 'Chloromycetin', ingredient: 'Chloramphenicol', strength: '0.5%', form: 'Eye drops', atc: 'S01AA01', category: 'OPHTHALMIC', therapeutic: 'Topical antibacterial', rx: true, cost: 12.0, price: 22.0, baseUnit: 'BOTTLE' },
  { generic: 'Tetracycline eye ointment', brand: 'Achromycin', ingredient: 'Tetracycline hydrochloride', strength: '1%', form: 'Eye ointment', atc: 'S01AA09', category: 'OPHTHALMIC', therapeutic: 'Topical antibacterial', rx: true, cost: 9.0, price: 17.0, baseUnit: 'TUBE' },
  { generic: 'Ciprofloxacin ear drops', brand: 'Ciloxan', ingredient: 'Ciprofloxacin hydrochloride', strength: '0.3%', form: 'Ear drops', atc: 'S02AA15', category: 'OTOLOGICAL', therapeutic: 'Topical antibacterial', rx: true, cost: 18.0, price: 32.0, baseUnit: 'BOTTLE' },

  { generic: 'Carbamazepine', brand: 'Tegretol', ingredient: 'Carbamazepine', strength: '200 mg', form: 'Tablet', atc: 'N03AF01', category: 'CNS', therapeutic: 'Anticonvulsant', rx: true, cost: 1.6, price: 3.6, baseUnit: 'TABLET' },
  { generic: 'Phenytoin', brand: 'Epanutin', ingredient: 'Phenytoin sodium', strength: '100 mg', form: 'Capsule', atc: 'N03AB02', category: 'CNS', therapeutic: 'Anticonvulsant', rx: true, highAlert: true, cost: 1.3, price: 3.0, baseUnit: 'CAPSULE' },
  { generic: 'Sodium valproate', brand: 'Epilim', ingredient: 'Sodium valproate', strength: '200 mg', form: 'Tablet', atc: 'N03AG01', category: 'CNS', therapeutic: 'Anticonvulsant', rx: true, cost: 2.0, price: 4.3, baseUnit: 'TABLET' },
  { generic: 'Amitriptyline', brand: 'Tryptizol', ingredient: 'Amitriptyline hydrochloride', strength: '25 mg', form: 'Tablet', atc: 'N06AA09', category: 'CNS', therapeutic: 'Tricyclic antidepressant', rx: true, cost: 0.9, price: 2.3, baseUnit: 'TABLET' },
  { generic: 'Fluoxetine', brand: 'Prozac', ingredient: 'Fluoxetine hydrochloride', strength: '20 mg', form: 'Capsule', atc: 'N06AB03', category: 'CNS', therapeutic: 'SSRI antidepressant', rx: true, cost: 2.4, price: 5.0, baseUnit: 'CAPSULE' },
  { generic: 'Haloperidol', brand: 'Haldol', ingredient: 'Haloperidol', strength: '5 mg', form: 'Tablet', atc: 'N05AD01', category: 'CNS', therapeutic: 'Typical antipsychotic', rx: true, cost: 1.5, price: 3.4, baseUnit: 'TABLET' },
  { generic: 'Chlorpromazine', brand: 'Largactil', ingredient: 'Chlorpromazine hydrochloride', strength: '100 mg', form: 'Tablet', atc: 'N05AA01', category: 'CNS', therapeutic: 'Typical antipsychotic', rx: true, cost: 1.1, price: 2.7, baseUnit: 'TABLET' },
  { generic: 'Risperidone', brand: 'Risperdal', ingredient: 'Risperidone', strength: '2 mg', form: 'Tablet', atc: 'N05AX08', category: 'CNS', therapeutic: 'Atypical antipsychotic', rx: true, cost: 3.4, price: 6.8, baseUnit: 'TABLET' },
  { generic: 'Allopurinol', brand: 'Zyloric', ingredient: 'Allopurinol', strength: '100 mg', form: 'Tablet', atc: 'M04AA01', category: 'MUSCULOSKELETAL', therapeutic: 'Xanthine oxidase inhibitor', rx: true, cost: 0.9, price: 2.2, baseUnit: 'TABLET' },
  // Alternative brands of molecules already stocked. Multiple brands of one
  // generic is the normal state of a pharmacy shelf, and it is what makes
  // generic-equivalent and alternative-brand relationships meaningful.
  { generic: 'Amoxicillin', brand: 'Ospamox', ingredient: 'Amoxicillin trihydrate', strength: '500 mg', form: 'Capsule', atc: 'J01CA04', category: 'ANTIBIOTIC', therapeutic: 'Penicillin antibacterial', rx: true, cost: 2.15, price: 4.1, baseUnit: 'CAPSULE' },
  { generic: 'Amoxicillin', brand: 'Moxilin', ingredient: 'Amoxicillin trihydrate', strength: '500 mg', form: 'Capsule', atc: 'J01CA04', category: 'ANTIBIOTIC', therapeutic: 'Penicillin antibacterial', rx: true, cost: 1.95, price: 3.8, baseUnit: 'CAPSULE' },
  { generic: 'Paracetamol', brand: 'Calpol', ingredient: 'Paracetamol', strength: '500 mg', form: 'Tablet', atc: 'N02BE01', category: 'ANALGESIC', therapeutic: 'Non-opioid analgesic', rx: false, cost: 0.32, price: 0.75, baseUnit: 'TABLET' },
  { generic: 'Paracetamol', brand: 'Adol', ingredient: 'Paracetamol', strength: '500 mg', form: 'Tablet', atc: 'N02BE01', category: 'ANALGESIC', therapeutic: 'Non-opioid analgesic', rx: false, cost: 0.28, price: 0.7, baseUnit: 'TABLET' },
  { generic: 'Metformin', brand: 'Glucophage XR', ingredient: 'Metformin hydrochloride', strength: '500 mg', form: 'Tablet', atc: 'A10BA02', category: 'ANTIDIABETIC', therapeutic: 'Biguanide', rx: true, cost: 1.1, price: 2.3, baseUnit: 'TABLET' },
  { generic: 'Omeprazole', brand: 'Omez', ingredient: 'Omeprazole', strength: '20 mg', form: 'Capsule', atc: 'A02BC01', category: 'GASTROINTESTINAL', therapeutic: 'Proton pump inhibitor', rx: false, cost: 1.4, price: 3.1, baseUnit: 'CAPSULE' },
  { generic: 'Atorvastatin', brand: 'Atorlip', ingredient: 'Atorvastatin calcium', strength: '20 mg', form: 'Tablet', atc: 'C10AA05', category: 'CARDIOVASCULAR', therapeutic: 'HMG-CoA reductase inhibitor', rx: true, cost: 2.2, price: 4.6, baseUnit: 'TABLET' },
  { generic: 'Amlodipine', brand: 'Amlogard', ingredient: 'Amlodipine besylate', strength: '5 mg', form: 'Tablet', atc: 'C08CA01', category: 'CARDIOVASCULAR', therapeutic: 'Calcium channel blocker', rx: true, cost: 0.85, price: 1.9, baseUnit: 'TABLET' },
  { generic: 'Ciprofloxacin', brand: 'Ciplox', ingredient: 'Ciprofloxacin hydrochloride', strength: '500 mg', form: 'Tablet', atc: 'J01MA02', category: 'ANTIBIOTIC', therapeutic: 'Fluoroquinolone', rx: true, cost: 3.3, price: 6.2, baseUnit: 'TABLET' },
  { generic: 'Ibuprofen', brand: 'Brufen', ingredient: 'Ibuprofen', strength: '400 mg', form: 'Tablet', atc: 'M01AE01', category: 'ANALGESIC', therapeutic: 'NSAID', rx: false, cost: 0.55, price: 1.25, baseUnit: 'TABLET' },
];

const SUPPLIER_NAMES = [
  'Ethiopian Pharmaceuticals Supply Service',
  'Kilitch Estro Biotech PLC',
  'Cadila Pharmaceuticals Ethiopia',
  'Julphar Pharmaceuticals Ethiopia',
  'East African Pharmaceuticals',
  'Addis Pharmaceutical Factory',
  'Sino-Ethiop Associate',
  'Rx Africa Trading PLC',
  'Medtech Ethiopia Import',
  'Zenith Pharmaceutical Imports',
  'Blue Nile Medical Supplies',
  'Horizon Healthcare Distribution',
  'Unipharm Wholesale PLC',
  'Abyssinia Medical Trading',
  'Global Health Supply Chain',
  'Meridian Pharma Distributors',
  'Rift Valley Medical Imports',
  'Selam Pharmaceutical Wholesale',
  'Ethio-Med Logistics PLC',
  'Continental Drug Distributors',
];

const MANUFACTURERS = [
  { name: 'Cadila Healthcare', country: 'IN' },
  { name: 'Cipla Ltd', country: 'IN' },
  { name: 'Sun Pharmaceutical', country: 'IN' },
  { name: 'GlaxoSmithKline', country: 'GB' },
  { name: 'Sanofi Aventis', country: 'FR' },
  { name: 'Novartis Pharma AG', country: 'CH' },
  { name: 'Pfizer Inc', country: 'US' },
  { name: 'Addis Pharmaceutical Factory', country: 'ET' },
  { name: 'East African Pharmaceuticals', country: 'ET' },
  { name: 'Julphar Gulf Pharmaceutical', country: 'AE' },
];

const PATIENT_NAMES = [
  'Abebe Kebede', 'Almaz Tesfaye', 'Bekele Girma', 'Chaltu Bekele', 'Dawit Haile',
  'Eleni Mengistu', 'Fikru Alemu', 'Genet Wolde', 'Hailu Tadesse', 'Iman Abdulahi',
  'Kalkidan Solomon', 'Lemlem Assefa', 'Mekonnen Desta', 'Nardos Yohannes', 'Oumer Hassan',
  'Rahel Gebre', 'Samuel Teshome', 'Tigist Negash', 'Yonas Berhanu', 'Zewditu Mulugeta',
  'Aster Demissie', 'Berhane Kidane', 'Dereje Worku', 'Frehiwot Ayele', 'Getachew Bogale',
];

const PRESCRIBERS = [
  { name: 'Dr. Selamawit Bekele', licence: 'ETH-MD-14872', facility: 'Tikur Anbessa Specialized Hospital' },
  { name: 'Dr. Yonatan Girma', licence: 'ETH-MD-20913', facility: 'St. Paul Hospital Millennium Medical College' },
  { name: 'Dr. Meron Tadesse', licence: 'ETH-MD-17456', facility: 'Zewditu Memorial Hospital' },
  { name: 'Dr. Abraham Mekonnen', licence: 'ETH-MD-11209', facility: 'Yekatit 12 Hospital' },
  { name: 'Dr. Hanna Wolde', licence: 'ETH-MD-23781', facility: 'Addis Hiwot General Hospital' },
];

async function main(): Promise<void> {
  console.log('Seeding PharmaCore demo data...');

  // ---- Reset (development only) ----
  console.log('  Clearing existing data...');
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs, notifications, notification_rules, documents, idempotency_keys,
      controlled_register_entries, approval_actions, workflow_instances, workflow_definitions,
      recall_tasks, recall_batches, recalls,
      temperature_excursions, temperature_logs, temperature_sensors,
      quality_incidents, disposal_items, disposals,
      return_items, returns,
      payments, sale_items, sales, cash_sessions,
      dispensing_items, dispensings, prescription_items, prescriptions, patients,
      stock_count_items, stock_counts, stock_adjustment_items, stock_adjustments,
      stock_transfer_items, stock_transfers,
      goods_receipt_items, goods_receipts,
      purchase_order_items, purchase_orders,
      supplier_quotation_items, supplier_quotations, rfq_items, rfqs,
      purchase_request_items, purchase_requests,
      stock_reservations, inventory_transactions, inventory_balances,
      serial_numbers, batches,
      supplier_products, suppliers,
      price_list_items, price_lists, patient_consents, customer_groups,
      product_relations, product_attributes, attribute_definitions, product_ingredients,
      price_history, product_barcodes, product_units, products,
      product_categories, manufacturers,
      job_runs, integration_deliveries, integration_endpoints,
      user_scopes, user_roles, sessions, login_attempts, role_permissions, permissions, roles, users,
      departments, warehouse_locations, warehouses, branches, regions, business_units,
      system_settings, organizations, backup_records
    RESTART IDENTITY CASCADE
  `);

  // ---- Organization, branches, warehouses (§18, §33) ----
  const org = await prisma.organization.create({
    data: {
      name: 'PharmaCore Pharmacy Group',
      legalName: 'PharmaCore Pharmaceuticals PLC',
      taxId: '0012345678',
      licenseNumber: 'EFDA-RET-2024-0912',
      country: 'ET',
      currency: 'ETB',
      timezone: 'Africa/Addis_Ababa',
      city: 'Addis Ababa',
      phone: '+251 11 551 2233',
      email: 'operations@pharmacore.example',
      valuationMethod: 'WEIGHTED_AVERAGE',
      allowNegativeStock: false,
    },
  });

  // ---- Business units and regions (§33) ----
  const retailUnit = await prisma.businessUnit.create({
    data: {
      organizationId: org.id,
      code: 'RETAIL',
      name: 'Retail Pharmacy',
      description: 'Community pharmacies serving walk-in and prescription customers.',
    },
  });
  const wholesaleUnit = await prisma.businessUnit.create({
    data: {
      organizationId: org.id,
      code: 'WHOLESALE',
      name: 'Wholesale & Institutional Supply',
      description: 'Central warehouse supplying institutions and the branch network.',
    },
  });

  const addisRegion = await prisma.region.create({
    data: { organizationId: org.id, businessUnitId: retailUnit.id, code: 'ADDIS', name: 'Addis Ababa' },
  });
  const regionsOutside = await prisma.region.create({
    data: { organizationId: org.id, businessUnitId: retailUnit.id, code: 'REGIONS', name: 'Regional Cities' },
  });

  const branchSeeds = [
    { code: 'HO', name: 'Head Office & Central Warehouse', isHeadOffice: true, city: 'Addis Ababa', lat: 9.0192, lng: 38.7525, branchType: 'DISTRIBUTION_CENTRE', unit: wholesaleUnit.id, region: null as string | null },
    { code: 'ADD01', name: 'Addis Pharmacy 01 - Bole', isHeadOffice: false, city: 'Addis Ababa', lat: 8.9806, lng: 38.7578, branchType: 'PHARMACY', unit: retailUnit.id, region: addisRegion.id },
    { code: 'ADD02', name: 'Addis Pharmacy 02 - Piassa', isHeadOffice: false, city: 'Addis Ababa', lat: 9.0347, lng: 38.7508, branchType: 'PHARMACY', unit: retailUnit.id, region: addisRegion.id },
    { code: 'ADA01', name: 'Adama Pharmacy', isHeadOffice: false, city: 'Adama', lat: 8.5400, lng: 39.2694, branchType: 'PHARMACY', unit: retailUnit.id, region: regionsOutside.id },
    { code: 'HAW01', name: 'Hawassa Pharmacy', isHeadOffice: false, city: 'Hawassa', lat: 7.0621, lng: 38.4764, branchType: 'PHARMACY', unit: retailUnit.id, region: regionsOutside.id },
  ];

  const branches: any[] = [];
  for (const b of branchSeeds) {
    branches.push(
      await prisma.branch.create({
        data: {
          organizationId: org.id,
          businessUnitId: b.unit,
          regionId: b.region,
          branchType: b.branchType,
          code: b.code,
          name: b.name,
          isHeadOffice: b.isHeadOffice,
          city: b.city,
          latitude: b.lat,
          longitude: b.lng,
          timezone: 'Africa/Addis_Ababa',
          costCentre: `CC-${b.code}`,
          licenseNumber: `EFDA-${b.code}-2024`,
          phone: '+251 11 5' + randomInt(100000, 999999),
        },
      }),
    );
  }

  // Departments give consumption a cost centre to attribute to (§33).
  let departmentCount = 0;
  for (const branch of branches) {
    const departmentSeeds = branch.isHeadOffice
      ? [
          { code: 'PROC', name: 'Procurement' },
          { code: 'QA', name: 'Quality Assurance' },
          { code: 'WH', name: 'Warehouse Operations' },
        ]
      : [
          { code: 'DISP', name: 'Dispensary' },
          { code: 'OTC', name: 'Over the counter' },
          { code: 'STORE', name: 'Back store' },
        ];
    for (const d of departmentSeeds) {
      await prisma.department.create({
        data: { branchId: branch.id, code: d.code, name: d.name, costCentre: `${branch.code}-${d.code}` },
      });
      departmentCount += 1;
    }
  }

  const warehouses: any[] = [];
  for (const [index, branch] of branches.entries()) {
    const isCentral = branch.isHeadOffice;
    warehouses.push(
      await prisma.warehouse.create({
        data: {
          branchId: branch.id,
          code: `${branch.code}-WH`,
          name: isCentral ? 'Addis Central Warehouse' : `${branch.name} Store`,
          isColdRoom: false,
        },
      }),
    );
    if (isCentral || index === 1) {
      warehouses.push(
        await prisma.warehouse.create({
          data: {
            branchId: branch.id,
            code: `${branch.code}-COLD`,
            name: isCentral ? 'Central Cold Room' : `${branch.name} Cold Room`,
            isColdRoom: true,
            minTempC: new Prisma.Decimal(2),
            maxTempC: new Prisma.Decimal(8),
          },
        }),
      );
    }
  }

  const centralWarehouse = warehouses[0];
  const centralColdRoom = warehouses.find((w) => w.code === 'HO-COLD')!;

  // Storage hierarchy for the central warehouse (§18)
  const room = await prisma.warehouseLocation.create({
    data: { warehouseId: centralWarehouse.id, code: 'RM-A', name: 'Main Store Room A', level: 'ROOM' },
  });
  const rack = await prisma.warehouseLocation.create({
    data: { warehouseId: centralWarehouse.id, parentId: room.id, code: 'RACK-C', name: 'Rack C', level: 'RACK' },
  });
  const shelf = await prisma.warehouseLocation.create({
    data: { warehouseId: centralWarehouse.id, parentId: rack.id, code: 'SHELF-03', name: 'Shelf 03', level: 'SHELF' },
  });
  const bins: any[] = [];
  for (let i = 1; i <= 6; i++) {
    bins.push(
      await prisma.warehouseLocation.create({
        data: {
          warehouseId: centralWarehouse.id,
          parentId: shelf.id,
          code: `C03-0${i}`,
          name: `Bin C03-0${i}`,
          level: 'BIN',
        },
      }),
    );
  }

  console.log(
    `  Created 2 business units, 2 regions, ${branches.length} branches, ` +
      `${departmentCount} departments, ${warehouses.length} warehouses`,
  );

  // ---- Permissions and roles (§4) ----
  const permissionRows = RESOURCE_CATALOG.flatMap((r) =>
    r.actions.map((a) => ({
      module: r.module,
      resource: r.resource,
      action: a as any,
      code: permissionCode(r.module, r.resource, a),
    })),
  );
  await prisma.permission.createMany({ data: permissionRows });
  const permissions = await prisma.permission.findMany();
  const permissionByCode = new Map(permissions.map((p) => [p.code, p]));

  for (const roleDef of DEFAULT_ROLES) {
    const role = await prisma.role.create({
      data: {
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description,
        isSystem: true,
      },
    });
    const codes = resolveRolePermissions(roleDef);
    await prisma.rolePermission.createMany({
      data: codes
        .map((c) => permissionByCode.get(c))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
  }
  const roles = await prisma.role.findMany();
  const roleByCode = new Map(roles.map((r) => [r.code, r]));
  console.log(`  Created ${permissions.length} permissions across ${roles.length} roles`);

  // ---- Users (§4) ----
  const demoPassword = await argon2.hash('PharmaCore#2026', { type: argon2.argon2id });

  const userSeeds = [
    { username: 'admin', email: 'admin@pharmacore.example', fullName: 'System Administrator', role: 'SUPER_ADMIN', branch: null },
    { username: 'manager', email: 'manager@pharmacore.example', fullName: 'Tsehay Alemayehu', role: 'PHARMACY_ADMIN', branch: null },
    { username: 'pharmacist', email: 'pharmacist@pharmacore.example', fullName: 'Selam Getachew', role: 'PHARMACIST', branch: 1, licence: 'ETH-PH-8821' },
    { username: 'pharmacist2', email: 'pharmacist2@pharmacore.example', fullName: 'Bereket Hailu', role: 'PHARMACIST', branch: 2, licence: 'ETH-PH-9134' },
    { username: 'technician', email: 'technician@pharmacore.example', fullName: 'Meseret Tilahun', role: 'PHARMACY_TECHNICIAN', branch: 1 },
    { username: 'procurement', email: 'procurement@pharmacore.example', fullName: 'Daniel Wolde', role: 'PROCUREMENT_OFFICER', branch: null },
    { username: 'warehouse', email: 'warehouse@pharmacore.example', fullName: 'Girma Assefa', role: 'WAREHOUSE_MANAGER', branch: 0 },
    { username: 'storekeeper', email: 'storekeeper@pharmacore.example', fullName: 'Tesfaye Bekele', role: 'STOREKEEPER', branch: 0 },
    { username: 'cashier', email: 'cashier@pharmacore.example', fullName: 'Hiwot Mamo', role: 'CASHIER', branch: 1 },
    { username: 'finance', email: 'finance@pharmacore.example', fullName: 'Yeshi Tadesse', role: 'FINANCE_OFFICER', branch: null },
    { username: 'qa', email: 'qa@pharmacore.example', fullName: 'Dr. Kidist Alemu', role: 'QA_OFFICER', branch: null, licence: 'ETH-PH-5567' },
    { username: 'auditor', email: 'auditor@pharmacore.example', fullName: 'Solomon Negash', role: 'AUDITOR', branch: null },
    { username: 'branchmgr', email: 'branchmgr@pharmacore.example', fullName: 'Rahel Tekle', role: 'BRANCH_MANAGER', branch: 3 },
  ];

  const users: any[] = [];
  for (const u of userSeeds) {
    const user = await prisma.user.create({
      data: {
        email: u.email,
        username: u.username,
        fullName: u.fullName,
        passwordHash: demoPassword,
        licenseNumber: (u as any).licence ?? null,
        phone: '+251 9' + randomInt(10000000, 99999999),
        homeBranchId: u.branch !== null ? branches[u.branch].id : null,
      },
    });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: roleByCode.get(u.role)!.id },
    });
    // No scope rows = organization-wide access.
    if (u.branch !== null) {
      await prisma.userScope.create({
        data: { userId: user.id, branchId: branches[u.branch].id },
      });
    }
    users.push(user);
  }
  const adminUser = users[0];
  const pharmacistUser = users[2];
  const qaUser = users[10];
  const cashierUser = users[8];
  console.log(`  Created ${users.length} users (password for all: PharmaCore#2026)`);

  // ---- Manufacturers, categories, products (§5) ----
  const manufacturers: any[] = [];
  for (const m of MANUFACTURERS) {
    manufacturers.push(await prisma.manufacturer.create({ data: m }));
  }

  const categoryNames = Array.from(new Set(DRUGS.map((d) => d.category)));
  const categories = new Map<string, string>();
  for (const name of categoryNames) {
    const cat = await prisma.productCategory.create({
      data: { code: name, name: name.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) },
    });
    categories.set(name, cat.id);
  }

  const products: any[] = [];
  for (const [index, drug] of DRUGS.entries()) {
    const manufacturer = pick(manufacturers);
    // 12-digit body: '890' country-ish prefix + a 9-digit unique serial.
    const gtinBody = `890${String(100000000 + index)}`;
    // Compute a valid GTIN-13 check digit so scans pass validation.
    const digits = gtinBody.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    const gtin = gtinBody + check;

    const product = await prisma.product.create({
      data: {
        sku: `SKU-${String(index + 1).padStart(4, '0')}`,
        gtin,
        genericName: drug.generic,
        brandName: drug.brand,
        activeIngredient: drug.ingredient,
        strength: drug.strength,
        dosageForm: drug.form,
        routeOfAdmin: drug.form.includes('Inject') || drug.form === 'Infusion' ? 'Parenteral' : drug.form.includes('Eye') ? 'Ophthalmic' : 'Oral',
        manufacturerId: manufacturer.id,
        marketingAuthHolder: manufacturer.name,
        countryOfOrigin: manufacturer.country,
        categoryId: categories.get(drug.category)!,
        therapeuticClass: drug.therapeutic,
        atcCode: drug.atc,
        baseUnit: drug.baseUnit,
        packSize: 1,
        requiresPrescription: drug.rx,
        isControlled: drug.controlled ?? false,
        controlledSchedule: drug.controlled ? 'SCHEDULE_II' : null,
        isColdChain: drug.coldChain ?? false,
        isRefrigerated: drug.coldChain ?? false,
        isHighAlert: drug.highAlert ?? false,
        storageCondition: drug.coldChain ? 'REFRIGERATED' : 'ROOM_TEMPERATURE',
        minTempC: drug.coldChain ? new Prisma.Decimal(2) : null,
        maxTempC: drug.coldChain ? new Prisma.Decimal(8) : null,
        minShelfLifeDaysOnReceipt: drug.coldChain ? 90 : 180,
        reorderLevel: new Prisma.Decimal(randomInt(50, 400)),
        safetyStock: new Prisma.Decimal(randomInt(20, 150)),
        maximumStock: new Prisma.Decimal(randomInt(2000, 8000)),
        leadTimeDays: randomInt(7, 30),
        purchaseCost: new Prisma.Decimal(drug.cost),
        averageCost: new Prisma.Decimal(drug.cost),
        lastPurchaseCost: new Prisma.Decimal(drug.cost),
        // Programme medicines (ART, TB, vaccines) are dispensed free of charge.
        retailPrice: new Prisma.Decimal(drug.price),
        wholesalePrice: new Prisma.Decimal(drug.price * 0.85),
        taxRate: new Prisma.Decimal(drug.price === 0 ? 0 : 0.15),
      },
    });

    // Unit ladder: carton > box > strip > base unit (§6)
    const isUnitDose = ['TABLET', 'CAPSULE'].includes(drug.baseUnit);
    const unitRows = isUnitDose
      ? [
          { code: drug.baseUnit, name: drug.baseUnit, factorToBase: 1, isBaseUnit: true, isDispenseUnit: true },
          { code: 'STRIP', name: 'Strip of 10', factorToBase: 10 },
          { code: 'BOX', name: 'Box of 10 strips', factorToBase: 100, isPurchaseUnit: true },
          { code: 'CARTON', name: 'Carton of 20 boxes', factorToBase: 2000 },
        ]
      : [
          { code: drug.baseUnit, name: drug.baseUnit, factorToBase: 1, isBaseUnit: true, isDispenseUnit: true },
          { code: 'BOX', name: 'Box of 10', factorToBase: 10, isPurchaseUnit: true },
          { code: 'CARTON', name: 'Carton of 100', factorToBase: 100 },
        ];

    await prisma.productUnit.createMany({
      data: unitRows.map((u) => ({
        productId: product.id,
        code: u.code,
        name: u.name,
        factorToBase: new Prisma.Decimal(u.factorToBase),
        isBaseUnit: u.isBaseUnit ?? false,
        isPurchaseUnit: u.isPurchaseUnit ?? false,
        isDispenseUnit: u.isDispenseUnit ?? false,
      })),
    });

    await prisma.productBarcode.create({
      data: { productId: product.id, barcode: gtin, symbology: 'EAN13', isPrimary: true },
    });

    products.push(product);
  }
  console.log(`  Created ${products.length} products with unit ladders and barcodes`);

  // ---- Active ingredients (§1: features 4-7) ----
  // A combination product gets one row per ingredient, which is what makes
  // ingredient search and duplicate-therapy detection work at all.
  let ingredientRows = 0;
  for (const [index, drug] of DRUGS.entries()) {
    const product = products[index];
    // Combination products are written either "A + B" or "A/B"; both split
    // into one row per ingredient so the formula is queryable.
    const names = drug.ingredient.split(/\s*[+/]\s*/).map((n: string) => n.trim());
    const strengths = String(drug.strength).split(/\s*[+/]\s*/).map((v: string) => v.trim());

    const rows = names.map((name: string, i: number) => {
      const raw = strengths[i] ?? '';
      const match = /^([\d.]+)\s*([a-zA-Z%/]+)?/.exec(raw);
      return {
        productId: product.id,
        name,
        strengthValue: match ? new Prisma.Decimal(match[1]) : null,
        strengthUnit: match?.[2] ?? null,
        role: 'ACTIVE',
        sequence: i,
      };
    });

    await prisma.productIngredient.createMany({ data: rows, skipDuplicates: true });
    ingredientRows += rows.length;
  }
  console.log(`  Created ${ingredientRows} active-ingredient records`);

  // ---- Product relationships (§1: features 30-34) ----
  //
  // A shared 5-level ATC code means the same chemical substance. Combined with
  // the same dosage form and strength, that is a genuine generic equivalent —
  // not a guess. Both directions are written, so a substitution lookup returns
  // the same set whichever product the pharmacist started from.
  const byMolecule = new Map<string, any[]>();
  for (const [index, drug] of DRUGS.entries()) {
    const key = `${drug.atc}|${drug.form}|${drug.strength}`;
    if (!byMolecule.has(key)) byMolecule.set(key, []);
    byMolecule.get(key)!.push({ product: products[index], drug });
  }

  let relationRows = 0;
  for (const group of byMolecule.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        // Different brand of the same molecule is both an equivalent and an
        // alternative brand; they answer different questions at the counter.
        const relationType =
          group[i].drug.brand === group[j].drug.brand ? 'VARIANT' : 'GENERIC_EQUIVALENT';
        await prisma.productRelation.create({
          data: {
            productId: group[i].product.id,
            relatedProductId: group[j].product.id,
            relationType,
            notes: `Same ATC ${group[i].drug.atc}, ${group[i].drug.form}, ${group[i].drug.strength}`,
          },
        });
        relationRows += 1;

        if (relationType === 'GENERIC_EQUIVALENT') {
          await prisma.productRelation.create({
            data: {
              productId: group[i].product.id,
              relatedProductId: group[j].product.id,
              relationType: 'ALTERNATIVE_BRAND',
              notes: `${group[j].drug.brand} is an alternative brand of ${group[i].drug.generic}`,
            },
          });
          relationRows += 1;
        }
      }
    }
  }
  console.log(`  Created ${relationRows} product relationships`);

  // ---- Administrator-defined product attributes (§1: feature 49) ----
  const attributeDefs = await Promise.all(
    [
      { code: 'SHELF_LOCATION', label: 'Default shelf location', dataType: 'TEXT', group: 'Storage', sequence: 1 },
      { code: 'EFDA_CATEGORY', label: 'EFDA registration category', dataType: 'SELECT', options: ['Essential', 'Non-essential', 'Programme'], group: 'Regulatory', sequence: 2 },
      { code: 'REQUIRES_FRIDGE_BAG', label: 'Needs a cold bag for delivery', dataType: 'BOOLEAN', group: 'Storage', sequence: 3 },
      { code: 'FORMULARY_RANK', label: 'Formulary rank', dataType: 'NUMBER', group: 'Clinical', sequence: 4 },
    ].map((d) => prisma.attributeDefinition.create({ data: d as any })),
  );

  const efdaDef = attributeDefs.find((d) => d.code === 'EFDA_CATEGORY')!;
  const fridgeDef = attributeDefs.find((d) => d.code === 'REQUIRES_FRIDGE_BAG')!;
  for (const [index, drug] of DRUGS.entries()) {
    await prisma.productAttribute.create({
      data: {
        productId: products[index].id,
        definitionId: efdaDef.id,
        value: drug.price === 0 ? 'Programme' : drug.rx ? 'Essential' : 'Non-essential',
      },
    });
    if (drug.coldChain) {
      await prisma.productAttribute.create({
        data: { productId: products[index].id, definitionId: fridgeDef.id, value: 'true' },
      });
    }
  }
  console.log(`  Created ${attributeDefs.length} attribute definitions with values`);

  // ---- Customer groups and price lists (§2: features 91-100) ----
  const customerGroups = await Promise.all(
    [
      { code: 'RETAIL', name: 'Walk-in retail', discountPercent: new Prisma.Decimal(0) },
      { code: 'STAFF', name: 'Staff and family', discountPercent: new Prisma.Decimal(0.15) },
      { code: 'INSURED', name: 'Insured patients', discountPercent: new Prisma.Decimal(0) },
      { code: 'CORPORATE', name: 'Corporate accounts', discountPercent: new Prisma.Decimal(0.05) },
      { code: 'NGO', name: 'NGO and institutional', discountPercent: new Prisma.Decimal(0.1) },
    ].map((g) => prisma.customerGroup.create({ data: g })),
  );

  const insuredGroup = customerGroups.find((g) => g.code === 'INSURED')!;
  const corporateGroup = customerGroups.find((g) => g.code === 'CORPORATE')!;

  const insuranceList = await prisma.priceList.create({
    data: {
      code: 'PL-INSURANCE',
      name: 'Insurance schedule 2026',
      listType: 'INSURANCE',
      customerGroupId: insuredGroup.id,
      priority: 50,
      notes: 'Reimbursement prices agreed with the insurer for the 2026 year.',
    },
  });

  const wholesaleList = await prisma.priceList.create({
    data: {
      code: 'PL-WHOLESALE',
      name: 'Wholesale and institutional',
      listType: 'WHOLESALE',
      customerGroupId: corporateGroup.id,
      priority: 40,
    },
  });

  // A promotional list that expires, so the effective-window logic has
  // something real to exercise.
  const promoList = await prisma.priceList.create({
    data: {
      code: 'PL-PROMO-Q3',
      name: 'Q3 OTC promotion',
      listType: 'PROMOTIONAL',
      priority: 90,
      effectiveFrom: new Date(Date.now() - 14 * 86_400_000),
      effectiveTo: new Date(Date.now() + 30 * 86_400_000),
      notes: 'Time-limited promotion; outranks the standing lists while it runs.',
    },
  });

  let priceRows = 0;
  for (const [index, drug] of DRUGS.entries()) {
    if (drug.price === 0) continue;
    const product = products[index];

    await prisma.priceListItem.create({
      data: {
        priceListId: insuranceList.id,
        productId: product.id,
        unitPrice: new Prisma.Decimal((drug.price * 0.9).toFixed(4)),
      },
    });
    priceRows += 1;

    // Wholesale carries a quantity break, so the break logic is covered.
    await prisma.priceListItem.createMany({
      data: [
        {
          priceListId: wholesaleList.id,
          productId: product.id,
          unitPrice: new Prisma.Decimal((drug.price * 0.85).toFixed(4)),
          minQuantity: new Prisma.Decimal(0),
        },
        {
          priceListId: wholesaleList.id,
          productId: product.id,
          unitPrice: new Prisma.Decimal((drug.price * 0.78).toFixed(4)),
          minQuantity: new Prisma.Decimal(500),
        },
      ],
    });
    priceRows += 2;

    if (!drug.rx && index % 7 === 0) {
      await prisma.priceListItem.create({
        data: {
          priceListId: promoList.id,
          productId: product.id,
          unitPrice: new Prisma.Decimal((drug.price * 0.8).toFixed(4)),
        },
      });
      priceRows += 1;
    }
  }
  console.log(`  Created ${customerGroups.length} customer groups and ${priceRows} price-list lines`);

  // ---- Suppliers (§13) ----
  const suppliers: any[] = [];
  for (const [index, name] of SUPPLIER_NAMES.entries()) {
    suppliers.push(
      await prisma.supplier.create({
        data: {
          code: `SUP-${String(index + 1).padStart(3, '0')}`,
          companyName: name,
          contactName: pick(PATIENT_NAMES),
          phone: '+251 11 ' + randomInt(1000000, 9999999),
          email: `sales${index + 1}@supplier.example`,
          city: pick(['Addis Ababa', 'Adama', 'Bishoftu', 'Dire Dawa']),
          country: 'ET',
          taxId: String(randomInt(100000000, 999999999)),
          licenseNumber: `EFDA-IMP-${2000 + index}`,
          // A couple of licences expire soon, to exercise the §44 alert.
          licenseExpiry: index < 2 ? daysFromNow(randomInt(10, 45)) : daysFromNow(randomInt(200, 900)),
          paymentTerms: pick(['NET30', 'NET45', 'NET60', 'NET15']),
          currency: 'ETB',
          leadTimeDays: randomInt(5, 35),
          minimumOrderValue: new Prisma.Decimal(randomInt(1000, 20000)),
          isActive: true,
          isApproved: index < 18,
          onTimeDeliveryRate: new Prisma.Decimal((0.6 + random() * 0.4).toFixed(4)),
          avgLeadTimeDays: new Prisma.Decimal(randomInt(6, 32)),
          rejectionRate: new Prisma.Decimal((random() * 0.08).toFixed(4)),
          shortShipmentRate: new Prisma.Decimal((random() * 0.15).toFixed(4)),
          qualityIncidents: randomInt(0, 3),
          supplierScore: new Prisma.Decimal((55 + random() * 45).toFixed(2)),
        },
      }),
    );
  }

  // Link each product to two or three suppliers with different prices.
  for (const product of products) {
    const chosen = new Set<string>();
    for (let i = 0; i < randomInt(2, 3); i++) chosen.add(pick(suppliers).id);
    let preferred = true;
    for (const supplierId of chosen) {
      await prisma.supplierProduct.create({
        data: {
          supplierId,
          productId: product.id,
          unitPrice: new Prisma.Decimal(
            (Number(product.purchaseCost) * (0.9 + random() * 0.3)).toFixed(4),
          ),
          moq: new Prisma.Decimal(randomInt(1, 10) * 100),
          leadTimeDays: randomInt(5, 30),
          isPreferred: preferred,
        },
      });
      if (preferred) {
        await prisma.product.update({
          where: { id: product.id },
          data: { preferredSupplierId: supplierId },
        });
      }
      preferred = false;
    }
  }
  console.log(`  Created ${suppliers.length} suppliers with product price lists`);

  // ---- Batches and opening stock (§7, §19) ----
  // Expiry profile deliberately spans expired, near-expiry and long-dated so
  // the expiry dashboard and FEFO have something real to work with.
  const expiryProfiles = [
    { weight: 4, min: -120, max: -5 },     // already expired
    { weight: 10, min: 5, max: 30 },       // 0-30 days
    { weight: 10, min: 31, max: 60 },      // 31-60 days
    { weight: 12, min: 61, max: 90 },      // 61-90 days
    { weight: 20, min: 91, max: 180 },     // 91-180 days
    { weight: 20, min: 181, max: 365 },    // 181-365 days
    { weight: 24, min: 366, max: 900 },    // long dated
  ];
  const weightedProfiles = expiryProfiles.flatMap((p) => Array(p.weight).fill(p));

  let batchCount = 0;
  let transactionCount = 0;
  const allBatches: Array<{ id: string; productId: string; expiryDate: Date; warehouseId: string; branchId: string }> = [];

  for (const product of products) {
    // Every product gets stock in the central warehouse plus one or two branches.
    const targetWarehouses = [centralWarehouse, ...warehouses.filter((w) => !w.isColdRoom && w.id !== centralWarehouse.id).slice(0, randomInt(1, 3))];
    const useCold = product.isColdChain;

    for (const warehouse of useCold ? [centralColdRoom] : targetWarehouses) {
      const batchesForProduct = randomInt(1, 3);
      for (let b = 0; b < batchesForProduct; b++) {
        const profile = pick(weightedProfiles);
        const expiryDays = randomInt(profile.min, profile.max);
        const expiryDate = daysFromNow(expiryDays);
        const isExpired = expiryDays < 0;

        const quantity = randomInt(50, 3000);
        const cost = Number(product.purchaseCost) * (0.92 + random() * 0.2);
        batchCount += 1;

        const branch = branches.find((br) => br.id === warehouse.branchId)!;
        const batch = await prisma.batch.create({
          data: {
            // Global counter keeps batch numbers unique per product.
            batchNumber: `${product.sku.slice(4)}-${2025 + Math.floor(random() * 2)}${String(batchCount % 100).padStart(2, '0')}-${batchCount}`,
            productId: product.id,
            supplierId: pick(suppliers).id,
            manufacturerName: MANUFACTURERS[randomInt(0, MANUFACTURERS.length - 1)].name,
            manufacturingDate: new Date(expiryDate.getTime() - randomInt(365, 730) * 86_400_000),
            expiryDate,
            receivedDate: daysFromNow(-randomInt(10, 300)),
            receivedQuantity: new Prisma.Decimal(quantity),
            purchaseCost: new Prisma.Decimal(cost.toFixed(4)),
            // Most stock is released; a slice stays quarantined for QA to work through.
            status: isExpired
              ? BatchStatus.EXPIRED
              : random() < 0.08
                ? BatchStatus.QUARANTINED
                : BatchStatus.RELEASED,
            quarantineReason: !isExpired && random() < 0.08 ? 'QUALITY_INVESTIGATION' : null,
            releasedById: qaUser.id,
            releasedAt: daysFromNow(-randomInt(5, 250)),
          },
        });

        // Expired batches hold no stock: they were swept out already.
        if (!isExpired) {
          const locationId = warehouse.id === centralWarehouse.id ? pick(bins).id : null;
          await prisma.inventoryBalance.create({
            data: {
              productId: product.id,
              batchId: batch.id,
              warehouseId: warehouse.id,
              locationId,
              branchId: branch.id,
              onHand: new Prisma.Decimal(quantity),
              lastMovementAt: daysFromNow(-randomInt(1, 120)),
            },
          });
          await prisma.inventoryTransaction.create({
            data: {
              type: 'PURCHASE_RECEIPT',
              productId: product.id,
              batchId: batch.id,
              warehouseId: warehouse.id,
              locationId,
              branchId: branch.id,
              quantityIn: new Prisma.Decimal(quantity),
              balanceAfter: new Prisma.Decimal(quantity),
              unitCost: new Prisma.Decimal(cost.toFixed(4)),
              referenceType: 'OPENING_STOCK',
              referenceNo: 'OPENING',
              occurredAt: daysFromNow(-randomInt(10, 300)),
              performedById: adminUser.id,
            },
          });
          transactionCount += 1;
          allBatches.push({
            id: batch.id,
            productId: product.id,
            expiryDate,
            warehouseId: warehouse.id,
            branchId: branch.id,
          });
        }
      }
    }
  }
  console.log(`  Created ${batchCount} batches and ${transactionCount} opening stock movements`);

  // ---- Patients (§25) and their CRM records (§14) ----
  const patients: any[] = [];
  let consentCount = 0;
  for (const [index, name] of PATIENT_NAMES.entries()) {
    // A quarter of patients are insured, a few are corporate accounts; the rest
    // are ordinary walk-ins. This gives the pricing engine real segments to
    // resolve against rather than one uniform group.
    const group =
      index % 4 === 0
        ? customerGroups.find((g) => g.code === 'INSURED')!
        : index % 9 === 0
          ? customerGroups.find((g) => g.code === 'CORPORATE')!
          : customerGroups.find((g) => g.code === 'RETAIL')!;

    const insured = group.code === 'INSURED';
    const loyaltyPoints = randomInt(0, 2400);

    const patient = await prisma.patient.create({
      data: {
        patientCode: `PT-${String(index + 1).padStart(6, '0')}`,
        fullName: name,
        dateOfBirth: new Date(1955 + randomInt(0, 55), randomInt(0, 11), randomInt(1, 28)),
        sex: index % 2 === 0 ? 'M' : 'F',
        phone: '+251 9' + randomInt(10000000, 99999999),
        city: pick(['Addis Ababa', 'Adama', 'Hawassa']),
        allergies: random() < 0.2 ? pick(['Penicillin', 'Sulfa drugs', 'Aspirin', 'Iodine']) : null,
        customerGroupId: group.id,
        patientType: group.code === 'CORPORATE' ? 'CORPORATE' : 'INDIVIDUAL',
        organizationName: group.code === 'CORPORATE' ? pick(['Ethio Telecom', 'Awash Bank', 'Ethiopian Airlines']) : null,
        preferredLanguage: pick(['en', 'am', 'om']),
        communicationPrefs: { sms: random() < 0.7, email: random() < 0.3, whatsapp: false },
        insuranceProvider: insured ? pick(['Nyala Insurance', 'Awash Insurance', 'CBHI']) : null,
        insuranceMemberNo: insured ? `INS-${randomInt(100000, 999999)}` : null,
        creditLimit: group.code === 'CORPORATE' ? new Prisma.Decimal(50000) : new Prisma.Decimal(0),
        loyaltyPoints,
        loyaltyTier: loyaltyPoints > 2000 ? 'GOLD' : loyaltyPoints > 1000 ? 'SILVER' : loyaltyPoints > 300 ? 'BRONZE' : 'NONE',
      },
    });
    patients.push(patient);

    // Consent is versioned and never edited in place (§14).
    await prisma.patientConsent.create({
      data: {
        patientId: patient.id,
        consentType: 'DATA_PROCESSING',
        version: '2026.1',
        granted: true,
        method: 'IN_PERSON',
      },
    });
    consentCount += 1;

    if (random() < 0.6) {
      const marketingGranted = random() < 0.7;
      await prisma.patientConsent.create({
        data: {
          patientId: patient.id,
          consentType: 'SMS',
          version: '2026.1',
          granted: marketingGranted,
          method: 'IN_PERSON',
          // A withdrawal is recorded on the row, not by deleting it.
          withdrawnAt: marketingGranted ? null : new Date(Date.now() - randomInt(1, 200) * 86_400_000),
        },
      });
      consentCount += 1;
    }
  }
  console.log(`  Created ${patients.length} patients with ${consentCount} consent records`);

  // ---- Prescriptions, dispensing and sales history ----
  const rxProducts = products.filter((p) => p.requiresPrescription && !p.isControlled);
  const otcProducts = products.filter((p) => !p.requiresPrescription);

  let prescriptionCount = 0;
  let dispensingCount = 0;
  for (let i = 0; i < 40; i++) {
    const patient = pick(patients);
    const prescriber = pick(PRESCRIBERS);
    const branch = branches[randomInt(1, 4)];
    const warehouse = warehouses.find((w) => w.branchId === branch.id && !w.isColdRoom)!;

    const lineProducts = Array.from({ length: randomInt(1, 3) }, () => pick(rxProducts));
    const prescription = await prisma.prescription.create({
      data: {
        prescriptionNo: `RX-2026-${String(i + 1).padStart(6, '0')}`,
        patientId: patient.id,
        branchId: branch.id,
        prescriberName: prescriber.name,
        prescriberLicense: prescriber.licence,
        facilityName: prescriber.facility,
        prescriptionDate: daysFromNow(-randomInt(1, 90)),
        status: i < 30 ? 'DISPENSED' : i < 36 ? 'APPROVED' : 'NEW',
        reviewedById: i < 36 ? pharmacistUser.id : null,
        reviewedAt: i < 36 ? daysFromNow(-randomInt(1, 89)) : null,
        items: {
          create: lineProducts.map((p) => ({
            productId: p.id,
            strength: p.strength,
            dosage: pick(['1 tablet', '2 tablets', '5 ml', '1 capsule']),
            frequency: pick(['Once daily', 'Twice daily', 'Three times daily', 'Every 8 hours']),
            durationDays: pick([5, 7, 10, 14, 30]),
            prescribedQty: new Prisma.Decimal(randomInt(10, 60)),
            dispensedQty: new Prisma.Decimal(0),
            instructions: pick(['Take after food', 'Take before food', 'Complete the full course']),
          })),
        },
      },
      include: { items: true },
    });
    prescriptionCount += 1;

    // Dispense the first 30, drawing on the nearest-expiry batch (FEFO).
    if (i < 30) {
      const dispensing = await prisma.dispensing.create({
        data: {
          dispensingNo: `DSP-2026-${String(i + 1).padStart(6, '0')}`,
          prescriptionId: prescription.id,
          patientId: patient.id,
          branchId: branch.id,
          warehouseId: warehouse.id,
          pharmacistId: pharmacistUser.id,
          dispensedAt: daysFromNow(-randomInt(1, 88)),
        },
      });
      dispensingCount += 1;

      for (const item of prescription.items) {
        const candidates = allBatches
          .filter((b) => b.productId === item.productId && b.warehouseId === warehouse.id)
          .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
        const batch = candidates[0];
        if (!batch) continue;

        const balance = await prisma.inventoryBalance.findFirst({
          where: { batchId: batch.id, warehouseId: warehouse.id },
        });
        if (!balance || balance.onHand.lessThan(item.prescribedQty)) continue;

        const after = balance.onHand.minus(item.prescribedQty);
        await prisma.inventoryBalance.update({
          where: { id: balance.id },
          data: { onHand: after, lastMovementAt: dispensing.dispensedAt },
        });
        await prisma.inventoryTransaction.create({
          data: {
            type: 'DISPENSING',
            productId: item.productId,
            batchId: batch.id,
            warehouseId: warehouse.id,
            branchId: branch.id,
            quantityOut: item.prescribedQty,
            balanceAfter: after,
            referenceType: 'DISPENSING',
            referenceId: dispensing.id,
            referenceNo: dispensing.dispensingNo,
            occurredAt: dispensing.dispensedAt,
            performedById: pharmacistUser.id,
          },
        });
        await prisma.dispensingItem.create({
          data: {
            dispensingId: dispensing.id,
            productId: item.productId,
            batchId: batch.id,
            quantity: item.prescribedQty,
            unitPrice: new Prisma.Decimal(0),
            fefoRecommendedBatchId: batch.id,
          },
        });
        await prisma.prescriptionItem.update({
          where: { id: item.id },
          data: { dispensedQty: item.prescribedQty },
        });
      }
    }
  }

  // OTC sales history, so the dashboard and forecasting have a real series.
  let saleCount = 0;
  for (let i = 0; i < 120; i++) {
    const branch = branches[randomInt(1, 4)];
    const warehouse = warehouses.find((w) => w.branchId === branch.id && !w.isColdRoom)!;
    const soldAt = daysFromNow(-randomInt(0, 89));

    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    let costTotal = new Prisma.Decimal(0);
    const saleLines: any[] = [];

    for (let l = 0; l < randomInt(1, 4); l++) {
      const product = pick(otcProducts);
      const candidates = allBatches
        .filter((b) => b.productId === product.id && b.warehouseId === warehouse.id)
        .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
      const batch = candidates[0];
      if (!batch) continue;

      const balance = await prisma.inventoryBalance.findFirst({
        where: { batchId: batch.id, warehouseId: warehouse.id },
      });
      const quantity = randomInt(1, 20);
      if (!balance || balance.onHand.lessThan(quantity)) continue;

      const gross = new Prisma.Decimal(quantity).times(product.retailPrice);
      const tax = gross.times(product.taxRate);
      const cost = new Prisma.Decimal(quantity).times(product.averageCost);
      subtotal = subtotal.plus(gross);
      taxTotal = taxTotal.plus(tax);
      costTotal = costTotal.plus(cost);

      const after = balance.onHand.minus(quantity);
      await prisma.inventoryBalance.update({
        where: { id: balance.id },
        data: { onHand: after, lastMovementAt: soldAt },
      });
      saleLines.push({ product, batch, quantity, gross, tax, cost, after, warehouse, branch });
    }

    if (!saleLines.length) continue;

    const grandTotal = subtotal.plus(taxTotal);
    const sale = await prisma.sale.create({
      data: {
        saleNo: `SALE-2026-${String(i + 1).padStart(6, '0')}`,
        branchId: branch.id,
        warehouseId: warehouse.id,
        cashierId: cashierUser.id,
        status: 'COMPLETED',
        subtotal,
        taxTotal,
        grandTotal,
        costTotal,
        soldAt,
      },
    });
    saleCount += 1;

    for (const line of saleLines) {
      await prisma.saleItem.create({
        data: {
          saleId: sale.id,
          productId: line.product.id,
          batchId: line.batch.id,
          quantity: new Prisma.Decimal(line.quantity),
          unitPrice: line.product.retailPrice,
          unitCost: line.product.averageCost,
          taxRate: line.product.taxRate,
          lineTotal: line.gross.plus(line.tax),
        },
      });
      await prisma.inventoryTransaction.create({
        data: {
          type: 'SALE',
          productId: line.product.id,
          batchId: line.batch.id,
          warehouseId: line.warehouse.id,
          branchId: line.branch.id,
          quantityOut: new Prisma.Decimal(line.quantity),
          balanceAfter: line.after,
          unitCost: line.product.averageCost,
          referenceType: 'SALE',
          referenceId: sale.id,
          referenceNo: sale.saleNo,
          occurredAt: soldAt,
          performedById: cashierUser.id,
        },
      });
    }

    await prisma.payment.create({
      data: {
        saleId: sale.id,
        method: pick([PaymentMethod.CASH, PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.MOBILE_MONEY]),
        amount: grandTotal,
      },
    });
  }
  console.log(`  Created ${prescriptionCount} prescriptions, ${dispensingCount} dispensings, ${saleCount} sales`);

  // ---- Purchase orders (§11) ----
  for (let i = 0; i < 12; i++) {
    const supplier = pick(suppliers);
    const branch = branches[0];
    const items = Array.from({ length: randomInt(2, 6) }, () => pick(products));

    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    const itemRows = items.map((p) => {
      const qty = randomInt(5, 40) * 100;
      const unitPrice = p.purchaseCost;
      const net = unitPrice.times(qty);
      const tax = net.times(new Prisma.Decimal(0.15));
      subtotal = subtotal.plus(net);
      taxTotal = taxTotal.plus(tax);
      return {
        productId: p.id,
        orderedQty: new Prisma.Decimal(qty),
        unitPrice,
        taxRate: new Prisma.Decimal(0.15),
        lineTotal: net.plus(tax),
      };
    });

    const statuses = ['DRAFT', 'SUBMITTED', 'FINANCE_REVIEW', 'APPROVED', 'ORDERED', 'RECEIVED'] as const;
    const status = statuses[Math.min(i, statuses.length - 1)];

    await prisma.purchaseOrder.create({
      data: {
        poNo: `PO-2026-${String(i + 1).padStart(6, '0')}`,
        supplierId: supplier.id,
        branchId: branch.id,
        warehouseId: centralWarehouse.id,
        status,
        orderDate: status === 'ORDERED' || status === 'RECEIVED' ? daysFromNow(-randomInt(10, 60)) : null,
        // A couple of orders are overdue, to exercise the supplier-delay rule.
        expectedDate: i < 3 ? daysFromNow(-randomInt(2, 20)) : daysFromNow(randomInt(5, 40)),
        subtotal,
        taxTotal,
        grandTotal: subtotal.plus(taxTotal),
        createdById: users[5].id,
        approvedById: ['APPROVED', 'ORDERED', 'RECEIVED'].includes(status) ? users[9].id : null,
        approvedAt: ['APPROVED', 'ORDERED', 'RECEIVED'].includes(status) ? daysFromNow(-randomInt(5, 50)) : null,
        items: { create: itemRows },
      },
    });
  }

  // ---- Cold chain sensors (§29) ----
  const coldWarehouses = warehouses.filter((w) => w.isColdRoom);
  for (const [index, warehouse] of coldWarehouses.entries()) {
    const sensor = await prisma.temperatureSensor.create({
      data: {
        code: `SENSOR-${String(index + 1).padStart(2, '0')}`,
        name: `${warehouse.name} probe`,
        warehouseId: warehouse.id,
        minTempC: new Prisma.Decimal(2),
        maxTempC: new Prisma.Decimal(8),
        maxExcursionMinutes: 15,
      },
    });

    // 48 hours of readings at 30-minute intervals, mostly in range.
    const logs: any[] = [];
    for (let h = 96; h >= 0; h--) {
      const inRange = 4 + random() * 3;
      logs.push({
        sensorId: sensor.id,
        temperature: new Prisma.Decimal(inRange.toFixed(2)),
        humidity: new Prisma.Decimal((45 + random() * 15).toFixed(2)),
        recordedAt: new Date(Date.now() - h * 30 * 60_000),
        isBreach: false,
      });
    }
    await prisma.temperatureLog.createMany({ data: logs });
    await prisma.temperatureSensor.update({
      where: { id: sensor.id },
      data: { lastReadingAt: new Date() },
    });
  }

  // A resolved excursion in the history, awaiting a QA decision.
  const firstSensor = await prisma.temperatureSensor.findFirst();
  if (firstSensor) {
    await prisma.temperatureExcursion.create({
      data: {
        excursionNo: 'EXC-2026-000001',
        sensorId: firstSensor.id,
        startedAt: daysFromNow(-12),
        endedAt: new Date(daysFromNow(-12).getTime() + 17 * 60_000),
        durationMinutes: 17,
        minTempC: new Prisma.Decimal(8.4),
        maxTempC: new Prisma.Decimal(11.2),
        disposition: 'PENDING',
        investigation: 'Cold room door left open during a delivery. Awaiting QA assessment of affected vaccines.',
      },
    });
  }

  // ---- A worked recall example (§27, §72) ----
  const recallTarget = allBatches.find((b) => {
    const product = products.find((p) => p.id === b.productId);
    return product?.genericName === 'Amoxicillin';
  });

  if (recallTarget) {
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: recallTarget.id } });
    const inStock = await prisma.inventoryBalance.aggregate({
      where: { batchId: batch.id },
      _sum: { onHand: true },
    });
    const dispensed = await prisma.inventoryTransaction.aggregate({
      where: { batchId: batch.id, type: { in: ['DISPENSING', 'SALE'] } },
      _sum: { quantityOut: true },
    });

    const recall = await prisma.recall.create({
      data: {
        recallNo: 'RCL-2026-000001',
        productId: batch.productId,
        severity: 'CLASS_II',
        status: 'IN_PROGRESS',
        recallDate: daysFromNow(-4),
        reason:
          'Manufacturer notification: out-of-specification dissolution results identified during ongoing stability testing.',
        regulatoryReference: 'EFDA/REC/2026/0042',
        instructions:
          'Quarantine all remaining stock immediately. Contact patients dispensed from this batch and arrange replacement.',
        createdById: qaUser.id,
      },
    });

    await prisma.recallBatch.create({
      data: {
        recallId: recall.id,
        batchId: batch.id,
        quantityInStockAtActivation: inStock._sum.onHand ?? new Prisma.Decimal(0),
        quantityDispensedHistorical: dispensed._sum.quantityOut ?? new Prisma.Decimal(0),
        previousBatchStatus: batch.status,
      },
    });
    await prisma.batch.update({
      where: { id: batch.id },
      data: {
        status: BatchStatus.RECALLED,
        qualityNotes: `Recalled under RCL-2026-000001`,
      },
    });

    const holdings = await prisma.inventoryBalance.findMany({
      where: { batchId: batch.id, onHand: { gt: 0 } },
    });
    for (const holding of holdings) {
      await prisma.recallTask.create({
        data: {
          recallId: recall.id,
          batchId: batch.id,
          branchId: holding.branchId,
          warehouseId: holding.warehouseId,
          taskType: 'BLOCK_STOCK',
          quantity: holding.onHand,
          status: 'PENDING',
        },
      });
    }

    const affectedDispensings = await prisma.dispensingItem.findMany({
      where: { batchId: batch.id },
      include: { dispensing: true },
    });
    for (const item of affectedDispensings) {
      if (!item.dispensing.patientId) continue;
      await prisma.recallTask.create({
        data: {
          recallId: recall.id,
          batchId: batch.id,
          branchId: item.dispensing.branchId,
          taskType: 'NOTIFY_PATIENT',
          patientId: item.dispensing.patientId,
          dispensingId: item.dispensing.id,
          quantity: item.quantity,
          status: 'PENDING',
        },
      });
    }
    console.log(`  Created recall RCL-2026-000001 on batch ${batch.batchNumber}`);
  }

  // ---- Notification rules and workflow definitions ----
  await prisma.notificationRule.createMany({
    data: [
      { eventType: 'LOW_STOCK', channels: ['IN_APP', 'EMAIL'], roleCodes: ['PROCUREMENT_OFFICER'] },
      { eventType: 'EXPIRY_APPROACHING', channels: ['IN_APP'], roleCodes: ['WAREHOUSE_MANAGER'] },
      { eventType: 'TEMPERATURE_EXCURSION', channels: ['IN_APP', 'SMS'], roleCodes: ['QA_OFFICER'] },
      { eventType: 'RECALL', channels: ['IN_APP', 'EMAIL', 'SMS'], roleCodes: ['QA_OFFICER', 'PHARMACY_ADMIN'] },
      { eventType: 'RECEIVING_EXCEPTION', channels: ['IN_APP'], roleCodes: ['QA_OFFICER'] },
      { eventType: 'SUPPLIER_DELAY', channels: ['IN_APP'], roleCodes: ['PROCUREMENT_OFFICER'] },
    ],
  });

  await prisma.workflowDefinition.create({
    data: {
      code: 'PO_STANDARD',
      name: 'Standard purchase order approval',
      documentType: 'PURCHASE_ORDER',
      steps: [
        { step: 1, name: 'Procurement review', requiredPermission: 'procurement.purchase_order.APPROVE' },
        { step: 2, name: 'Finance review', requiredPermission: 'finance.invoice.APPROVE', minAmount: 50000 },
      ],
    },
  });

  await prisma.systemSetting.createMany({
    data: [
      { organizationId: org.id, key: 'expiry.thresholds', value: [30, 60, 90, 180, 365] },
      { organizationId: org.id, key: 'replenishment.autoOrder', value: false },
      { organizationId: org.id, key: 'count.varianceApprovalUnits', value: 10 },
      { organizationId: org.id, key: 'cash.varianceExplanationThreshold', value: 50 },
    ],
  });

  const summary = {
    branches: await prisma.branch.count(),
    warehouses: await prisma.warehouse.count(),
    products: await prisma.product.count(),
    suppliers: await prisma.supplier.count(),
    batches: await prisma.batch.count(),
    balances: await prisma.inventoryBalance.count(),
    transactions: await prisma.inventoryTransaction.count(),
    patients: await prisma.patient.count(),
    prescriptions: await prisma.prescription.count(),
    sales: await prisma.sale.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    recalls: await prisma.recall.count(),
    users: await prisma.user.count(),
  };

  console.log('\nSeed complete:');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(16)} ${value}`);
  }
  console.log('\nSign in with any of these usernames and the password PharmaCore#2026');
  console.log('  admin / manager / pharmacist / procurement / warehouse / cashier / qa / auditor\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
