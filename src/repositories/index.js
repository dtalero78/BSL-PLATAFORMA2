/**
 * Central export point for all repositories
 * Allows convenient importing: const { HistoriaClinicaRepository, FormulariosRepository } = require('./repositories');
 */

const BaseRepository = require('./BaseRepository');
const HistoriaClinicaRepository = require('./HistoriaClinicaRepository');
const FormulariosRepository = require('./FormulariosRepository');
const UsuariosRepository = require('./UsuariosRepository');
const ConversacionesWhatsAppRepository = require('./ConversacionesWhatsAppRepository');
const MensajesWhatsAppRepository = require('./MensajesWhatsAppRepository');
const EmpresasRepository = require('./EmpresasRepository');

module.exports = {
    BaseRepository,
    HistoriaClinicaRepository,
    FormulariosRepository,
    UsuariosRepository,
    ConversacionesWhatsAppRepository,
    MensajesWhatsAppRepository,
    EmpresasRepository
};
