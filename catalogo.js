// Catálogo de novedades. SI y SA se muestran bloqueados: la base también los rechaza.
const CATALOGO = [
  { code: 'SI', cat: 'Sindicalismo', crit: '', nivel: 'ilegal' },
  { code: 'SA', cat: 'Precedentes de salud', crit: '', nivel: 'ilegal' },
  { code: 'AP', cat: 'Abandono del puesto de trabajo', crit: 'Retiro injustificado acreditado conforme al procedimiento' },
  { code: 'CE', cat: 'Consumo de sustancias psicoactivas o embriagantes', crit: 'Incumplimiento confirmado de política de seguridad; no registrar diagnósticos' },
  { code: 'CI', cat: 'Conducción irresponsable', crit: 'Incumplimiento objetivo de normas o protocolos de conducción' },
  { code: 'CS', cat: 'Comportamiento sexual indebido', crit: 'Conducta investigada mediante protocolo de acoso/convivencia' },
  { code: 'FD', cat: 'Falsedad documental', crit: 'Alteración o presentación falsa confirmada mediante investigación' },
  { code: 'HC', cat: 'Hurto de combustible', crit: 'Diferencia investigada con responsabilidad establecida' },
  { code: 'HE', cat: 'Hurto de elementos del vehículo', crit: 'Faltante investigado con responsabilidad establecida' },
  { code: 'HL', cat: 'Hurto de liquidaciones o recaudos', crit: 'Hecho investigado y atribuible al conductor' },
  { code: 'MC', cat: 'Exceso de multas o comparendos operacionales', crit: 'Reincidencia según umbral aprobado' },
  { code: 'PO', cat: 'Incumplimiento de programación operacional', crit: 'Ausencia injustificada y documentada' },
  { code: 'SR', cat: 'Exceso de siniestros con responsabilidad', crit: 'Reincidencia según umbral y responsabilidad determinada' },
  { code: 'VC', cat: 'Violencia contra compañeros o terceros', crit: 'Incidente investigado con hallazgo documentado' },
];

const $ = (id) => document.getElementById(id);
