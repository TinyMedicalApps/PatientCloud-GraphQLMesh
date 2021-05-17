const moment = require("moment");
const _ = require("lodash");
const fetch = require("node-fetch");

const resolvers = {
  TinyMedicationResponse: {
    MedicationName: async (parent, args, context, info) => {
      return parent.medicationCodeableConcept.text;
    },
    Instructions: async (parent, args, context, info) => {
      const { dosageInstruction, dispenseRequest } = parent;
      const { expectedSupplyDuration, quantity } = dispenseRequest;

      // being dosageInstruction an array, reduce it to a single string
      const dosageInstructionsText = dosageInstruction.reduce((textAccumulator, instruction) => {
        const { timing, text } = instruction;

        return `${textAccumulator} ${text} ${quantity.unit}. Starting on ${moment(
          timing.repeat.boundsPeriod.start
        ).format("MMMM Do, YYYY")}`;
      }, "");

      return `${dosageInstructionsText}. ${quantity.value} ${quantity.unit}s (supply for ${expectedSupplyDuration.value} ${expectedSupplyDuration.unit}).`;
    },
    Fields: async (parent, args, context, info) => {
      const { fields } = args;

      return fields.reduce((fieldAccumulator, currentField) => {
        return { ...fieldAccumulator, [currentField]: _.get(parent, currentField) };
      }, {});
    },
  },
  Query: {
    TinyMedicationRequest: async (parent, args, context, info) => {
      // take PatientID from query arguments
      const { PatientID } = args;

      // context contains all the datasources defined in ".meshrc.yaml", in this case "LogicaHealth Sandbox v3"
      // then MedicationRequestByPatient is called in order to retrieve the data we want
      const res = await context["LogicaHealth Sandbox v3"].api.MedicationRequestByPatient({ PatientID });

      // res is { entry: [...list of entries] }
      // for each entry, parse and return the full data object
      return res.entry.map(async (el) => {
        try {
          const singleEntry = await fetch(el.fullUrl, {
            method: "GET",
            redirect: "follow",
          });

          // need to get response as text, then parse as object
          return JSON.parse(await singleEntry.text());
        } catch (error) {
          console.log("Error:", error);
          return {};
        }
      });
    },
  },
};

module.exports = { resolvers };
