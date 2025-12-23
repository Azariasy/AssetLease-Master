
import React from 'react';
import DecisionReport from '../../components/DecisionReport';
import { AnalysisResult } from '../../types';

interface DecisionReportPageProps {
  analysis: AnalysisResult | null;
  isAnalyzing: boolean;
  onStartAnalysis: () => void;
}

const DecisionReportPage: React.FC<DecisionReportPageProps> = (props) => {
  return (
    <div className="max-w-6xl mx-auto">
      <DecisionReport {...props} />
    </div>
  );
};

export default DecisionReportPage;
