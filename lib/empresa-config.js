// Datos de la empresa para los PDF de cotización.
// ⚠️ COMPLETAR con los datos reales: aparecen en el bloque "Datos para transferencia"
// del PDF. Si quedan vacíos (numero/banco), ese bloque NO se muestra.
export const DATOS_BANCARIOS = {
  titular: '',       // Ej: 'Sonqollay SpA'
  rut: '',           // RUT de la empresa, ej: '77.123.456-7'
  banco: '',         // Ej: 'Banco de Chile'
  tipoCuenta: '',    // Ej: 'Cuenta Corriente'
  numero: '',        // N° de cuenta, ej: '0001234567'
  email: '',         // correo para confirmar transferencias
};

// Texto por defecto de "Forma de pago" cuando la cotización no especifica uno.
export const FORMA_PAGO_DEFAULT = '';
