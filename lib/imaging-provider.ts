import { askDoctorOpus } from "./doctor-opus";

export type ImagingJob = {
  fileName: string;
  note: string;
};

export type ImagingResult = {
  provider: string;
  sent: false;
  text: string;
};

export interface ImagingProvider {
  name: string;
  read(job: ImagingJob): Promise<ImagingResult>;
}

export const doctorOpusImaging: ImagingProvider = {
  name: "doctor-opus-stub",
  async read(job) {
    const reply = askDoctorOpus(job.note || job.fileName);
    return { provider: "doctor-opus-stub", sent: false, text: reply.answer };
  },
};
