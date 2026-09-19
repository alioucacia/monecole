import { Route, Routes } from "react-router-dom";

import { AppLayout, ProtectedRoute } from "./components/Layout";
import { InstallPromptModal } from "./components/InstallPromptModal";
import { PwaBanners } from "./components/PwaBanners";
import AnnoncesPlateformePage from "./pages/AnnoncesPlateformePage";
import AnnouncementsPage from "./pages/AnnouncementsPage";
import AnnuaireUtilisateursPage from "./pages/AnnuaireUtilisateursPage";
import AgentCantinePage from "./pages/AgentCantinePage";
import AssistantIAPage from "./pages/AssistantIAPage";
import AttendancePage from "./pages/AttendancePage";
import BulletinPage from "./pages/BulletinPage";
import CaissePage from "./pages/CaissePage";
import CantinePage from "./pages/CantinePage";
import ChangerMotDePassePage from "./pages/ChangerMotDePassePage";
import ChauffeurPage from "./pages/ChauffeurPage";
import ClassesPage from "./pages/ClassesPage";
import ComptesEcolePage from "./pages/ComptesEcolePage";
import DashboardPage from "./pages/DashboardPage";
import DepensesPage from "./pages/DepensesPage";
import EcoleDetailPage from "./pages/EcoleDetailPage";
import EcolesPage from "./pages/EcolesPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import GradesPage from "./pages/GradesPage";
import ImpayesParClassePage from "./pages/ImpayesParClassePage";
import JournalActivitePage from "./pages/JournalActivitePage";
import JustificatifsPage from "./pages/JustificatifsPage";
import LibraryPage from "./pages/LibraryPage";
import LoginPage from "./pages/LoginPage";
import MessagesPage from "./pages/MessagesPage";
import VisioPage from "./pages/VisioPage";
import NotFoundPage from "./pages/NotFoundPage";
import ParametresEcolePage from "./pages/ParametresEcolePage";
import ParametresPlateformePage from "./pages/ParametresPlateformePage";
import PerformanceAnalysisPage from "./pages/PerformanceAnalysisPage";
import PaymentsPage from "./pages/PaymentsPage";
import PersonnelAdminPage from "./pages/PersonnelAdminPage";
import PlansAbonnementPage from "./pages/PlansAbonnementPage";
import ProfilePage from "./pages/ProfilePage";
import RechercheGlobalePage from "./pages/RechercheGlobalePage";
import RechercheMatriculePage from "./pages/RechercheMatriculePage";
import ReinscriptionPage from "./pages/ReinscriptionPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ResultsPage from "./pages/ResultsPage";
import SauvegardesPage from "./pages/SauvegardesPage";
import SchedulePage from "./pages/SchedulePage";
import SuperAdminAccountsPage from "./pages/SuperAdminAccountsPage";
import SchoolLifePage from "./pages/SchoolLifePage";
import StaffPage from "./pages/StaffPage";
import StudentDetailPage from "./pages/StudentDetailPage";
import StudentsPage from "./pages/StudentsPage";
import SubjectsPage from "./pages/SubjectsPage";
import SuiviMensuelPage from "./pages/SuiviMensuelPage";
import SupervisionPage from "./pages/SupervisionPage";
import SupportPage from "./pages/SupportPage";
import TarifsClassePage from "./pages/TarifsClassePage";
import TeachersPage from "./pages/TeachersPage";
import TransactionsPage from "./pages/TransactionsPage";
import TransportPage from "./pages/TransportPage";
import VerifyBadgePage from "./pages/VerifyBadgePage";

export default function App() {
  return (
    <>
    <PwaBanners />
    <InstallPromptModal />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
      <Route path="/reinitialiser-mot-de-passe/:uid/:token" element={<ResetPasswordPage />} />
      <Route
        path="/changer-mot-de-passe"
        element={
          <ProtectedRoute>
            <ChangerMotDePassePage />
          </ProtectedRoute>
        }
      />
      <Route path="/verifier-badge/:token" element={<VerifyBadgePage />} />
      <Route path="/chauffeur/:token" element={<ChauffeurPage />} />
      <Route path="/agent-cantine/:token" element={<AgentCantinePage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/ecoles"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <EcolesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ecoles/:id"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <EcoleDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/journal-activite"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <JournalActivitePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/comptes-superadmin"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <SuperAdminAccountsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recherche-globale"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <RechercheGlobalePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/plans-abonnement"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <PlansAbonnementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/annonces-plateforme"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <AnnoncesPlateformePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supervision"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <SupervisionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/annuaire-utilisateurs"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <AnnuaireUtilisateursPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/parametres-plateforme"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <ParametresPlateformePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transactions"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <TransactionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sauvegardes"
          element={
            <ProtectedRoute roles={["superadmin"]}>
              <SauvegardesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/parametres-ecole"
          element={
            <ProtectedRoute roles={["admin", "directeur"]}>
              <ParametresEcolePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/personnel-admin"
          element={
            <ProtectedRoute roles={["admin", "directeur"]}>
              <PersonnelAdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/comptes-ecole"
          element={
            <ProtectedRoute roles={["admin", "directeur"]}>
              <ComptesEcolePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/eleves"
          element={
            <ProtectedRoute roles={["admin", "directeur", "teacher", "comptabilite", "surveillance"]}>
              <StudentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/eleves/:id"
          element={
            <ProtectedRoute roles={["admin", "directeur", "teacher", "comptabilite", "surveillance"]}>
              <StudentDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reinscription"
          element={
            <ProtectedRoute roles={["admin", "directeur", "comptabilite"]}>
              <ReinscriptionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/enseignants"
          element={
            <ProtectedRoute roles={["admin", "directeur", "surveillance"]}>
              <TeachersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/classes"
          element={
            <ProtectedRoute roles={["admin", "directeur", "teacher", "surveillance"]}>
              <ClassesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/matieres"
          element={
            <ProtectedRoute roles={["admin", "directeur", "surveillance"]}>
              <SubjectsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/notes" element={<GradesPage />} />
        <Route path="/bulletins" element={<BulletinPage />} />
        <Route
          path="/analyse-performance"
          element={
            <ProtectedRoute roles={["student", "parent"]}>
              <PerformanceAnalysisPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/assistant-ia"
          element={
            <ProtectedRoute roles={["student"]} feature="assistant_ia">
              <AssistantIAPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/resultats"
          element={
            <ProtectedRoute roles={["admin", "directeur", "teacher"]}>
              <ResultsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/presences" element={<AttendancePage />} />
        <Route
          path="/justificatifs"
          element={
            <ProtectedRoute roles={["admin", "directeur", "student", "parent", "surveillance"]} feature="justificatifs">
              <JustificatifsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/vie-scolaire" element={<SchoolLifePage />} />
        <Route
          path="/personnel"
          element={
            <ProtectedRoute roles={["admin", "directeur", "teacher", "comptabilite", "surveillance"]}>
              <StaffPage />
            </ProtectedRoute>
          }
        />
        <Route path="/emploi-du-temps" element={<SchedulePage />} />
        <Route
          path="/paiements"
          element={
            <ProtectedRoute roles={["admin", "directeur", "student", "parent", "comptabilite"]}>
              <PaymentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/paiements/impayes-par-classe"
          element={
            <ProtectedRoute roles={["admin", "directeur", "comptabilite"]}>
              <ImpayesParClassePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/paiements/suivi-mensuel"
          element={
            <ProtectedRoute roles={["admin", "directeur", "comptabilite"]}>
              <SuiviMensuelPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/paiements/recherche-matricule"
          element={
            <ProtectedRoute roles={["admin", "directeur", "comptabilite"]}>
              <RechercheMatriculePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/paiements/tarifs-classe"
          element={
            <ProtectedRoute roles={["admin", "directeur", "comptabilite"]}>
              <TarifsClassePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/caisse"
          element={
            <ProtectedRoute roles={["admin", "directeur", "comptabilite"]}>
              <CaissePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/depenses"
          element={
            <ProtectedRoute roles={["admin", "directeur", "comptabilite"]}>
              <DepensesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bibliotheque"
          element={
            <ProtectedRoute feature="bibliotheque">
              <LibraryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transport"
          element={
            <ProtectedRoute roles={["admin", "directeur", "student", "parent", "comptabilite"]} feature="transport">
              <TransportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cantine"
          element={
            <ProtectedRoute roles={["admin", "directeur", "student", "parent", "comptabilite"]} feature="cantine">
              <CantinePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/messagerie"
          element={
            <ProtectedRoute feature="messagerie">
              <MessagesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/visioconference"
          element={
            <ProtectedRoute feature="visioconference">
              <VisioPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/annonces"
          element={
            <ProtectedRoute feature="annonces">
              <AnnouncementsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/support"
          element={
            <ProtectedRoute>
              <SupportPage />
            </ProtectedRoute>
          }
        />
        <Route path="/profil" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </>
  );
}
