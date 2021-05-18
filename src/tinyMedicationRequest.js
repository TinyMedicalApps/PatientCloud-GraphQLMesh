const moment = require("moment");
const _ = require("lodash");
const fetch = require("node-fetch");

const flattenObservations = (observations) => {
  return observations.reduce((acc, obs) => {
    if (obs.component) {
      acc.concat(
        obs.component.map((comp) => {
          return { ...obs, ...comp };
        })
      );
    } else {
      acc.push(obs);
    }

    return acc;
  }, []);
};

const sumValueQuantity = (arr) => {
  return arr.reduce((sum, item) => {
    if (item.valueQuantity) {
      return sum + item.valueQuantity.value;
    } else {
      return sum;
    }
  }, 0);
};

const ObservationByPatientWithArgs = async (args) => {
  const { PatientID } = args;

  const res = await fetch(
    `https://api.logicahealth.org/PatientCloud401/open/Observation?patient=${PatientID}&_total=accurate&_count=1000&code:code=19935-6`,
    {
      method: "GET",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return await res.json();
};

const resolvers = {
  TinyPeakFlowResponse: {
    statsForPeriod: async (parent, args, context, info) => {
      // console.log(moment(parent.effectiveDateTime).format("MM YYYY"));

      return Object.entries(parent.grouped).map(([key, obs]) => {
        return {
          AVGMeanValue: sumValueQuantity(obs) / obs.length,
          Date: moment(key, "MM_YYYY").format("MMMM YYYY"),
        };
      });
    },
    statsAllTime: async (parent, args, context, info) => {
      const bestValue = Math.max(
        ...parent.all.map((e) => {
          return e.valueQuantity.value;
        })
      );

      return {
        BestValue: bestValue,
        EIGHTYPCBestValue: bestValue * 0.8,
        AVGMeanValue: sumValueQuantity(parent.all) / parent.all.length,
      };
    },
  },
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

      if (fields) {
        return fields.reduce((fieldAccumulator, currentField) => {
          return { ...fieldAccumulator, [currentField]: _.get(parent, currentField) };
        }, {});
      } else {
        return null;
      }
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
    TinyPeakFlowStats: async (parent, args, context, info) => {
      // take PatientID from query arguments
      const { PatientID } = args;

      // context contains all the datasources defined in ".meshrc.yaml", in this case "LogicaHealth Sandbox v3"
      // then ObservationByPatient is called in order to retrieve the data we want
      const res = await ObservationByPatientWithArgs({
        PatientID,
      });
      // const res = await context["LogicaHealth Sandbox v3"].api.ObservationByPatient({
      //   PatientID,
      // });

      // res is { entry: [...list of entries] }
      // for each entry, parse and return the full data object
      return Promise.all(
        res.entry.map(async (el) => {
          try {
            const singleEntry = await fetch(el.fullUrl, {
              method: "GET",
              redirect: "follow",
            });

            // need to get response as text, then parse as object
            return await JSON.parse(await singleEntry.text());
          } catch (error) {
            console.log("Error:", error);
            return {};
          }
        })
      )
        .then((result) => {
          // console.log("result", result);

          const groupBy = flattenObservations(result).reduce((accumulator, observation) => {
            const monthyear = moment(observation.effectiveDateTime).format("MM_YYYY");

            if (accumulator[monthyear]) {
              accumulator[monthyear].push(observation);
            } else {
              accumulator[monthyear] = [observation];
            }

            return accumulator;
          }, {});

          return { grouped: groupBy, all: flattenObservations(result) };
        })
        .catch((error) => {
          console.log(error);
        });
    },
  },
};

module.exports = { resolvers };
